import type { AppState } from '../types';
import { EXPORT_APP, SCHEMA_VERSION, validateImport } from './storage';
import {
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  IV_BYTES,
  assertCrypto,
  base64ToBytes,
  bytesToBase64,
  deriveAesKey,
  randomBytes,
} from './crypto';

const ENCRYPTED_MARKER = 'xinshi-encrypted';

interface EncryptedEnvelope {
  app: typeof EXPORT_APP;
  version: number;
  encrypted: true;
  format: typeof ENCRYPTED_MARKER;
  alg: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  exportedAt: string;
}

export function isEncryptedBackup(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { app?: unknown; encrypted?: unknown };
    return parsed.app === EXPORT_APP && parsed.encrypted === true;
  } catch {
    return false;
  }
}

export async function encryptBackup(state: AppState, password: string): Promise<string> {
  const normalizedPassword = password.trim();
  if (normalizedPassword.length < 6) throw new Error('备份密码至少 6 位，且不能全是空格');
  const subtle = assertCrypto();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(normalizedPassword, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(state));
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const envelope: EncryptedEnvelope = {
    app: EXPORT_APP,
    version: SCHEMA_VERSION,
    encrypted: true,
    format: ENCRYPTED_MARKER,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
    exportedAt: new Date().toISOString(),
  };
  return JSON.stringify(envelope);
}

export async function decryptBackup(text: string, password: string): Promise<AppState> {
  const normalizedPassword = password.trim();
  if (!normalizedPassword) throw new Error('请输入备份密码');
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(text) as EncryptedEnvelope;
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (Number.isInteger(envelope.version) && envelope.version > SCHEMA_VERSION) {
    throw new Error('加密备份来自更新版本的薪时，请升级后再导入');
  }
  if (
    envelope.app !== EXPORT_APP ||
    envelope.encrypted !== true ||
    envelope.format !== ENCRYPTED_MARKER ||
    !Number.isInteger(envelope.version) ||
    envelope.version < 1 ||
    envelope.version > SCHEMA_VERSION ||
    envelope.alg !== 'AES-GCM' ||
    envelope.kdf !== 'PBKDF2-SHA256'
  ) {
    throw new Error('这不是薪时的加密备份文件');
  }
  if (
    !Number.isInteger(envelope.iterations) ||
    envelope.iterations < 100_000 ||
    envelope.iterations > 1_000_000
  ) {
    throw new Error('备份文件的加密参数不正确');
  }
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const data = base64ToBytes(envelope.data);
    const key = await deriveAesKey(normalizedPassword, salt, envelope.iterations);
    const plaintext = await assertCrypto().decrypt({ name: 'AES-GCM', iv }, key, data);
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    return validateImport(
      JSON.stringify({ app: EXPORT_APP, version: SCHEMA_VERSION, data: decoded }),
      { unlockOrphans: true },
    );
  } catch {
    throw new Error('密码错误，或备份文件已损坏');
  }
}
