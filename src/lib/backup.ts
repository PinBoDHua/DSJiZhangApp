import type { AppState } from '../types';
import { EXPORT_APP, SCHEMA_VERSION, validateImport } from './storage';

const ENCRYPTED_MARKER = 'xinshi-encrypted';
const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function assertCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持加密备份，请用较新的浏览器打开');
  }
  return globalThis.crypto.subtle;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const subtle = assertCrypto();
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
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
  if (!password.trim()) throw new Error('请输入备份密码');
  const subtle = assertCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
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
  if (!password) throw new Error('请输入备份密码');
  let envelope: EncryptedEnvelope;
  try {
    envelope = JSON.parse(text) as EncryptedEnvelope;
  } catch {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (
    envelope.app !== EXPORT_APP ||
    envelope.encrypted !== true ||
    envelope.format !== ENCRYPTED_MARKER ||
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
    const key = await deriveKey(password, salt, envelope.iterations);
    const plaintext = await assertCrypto().decrypt({ name: 'AES-GCM', iv }, key, data);
    const decoded = JSON.parse(new TextDecoder().decode(plaintext));
    return validateImport(
      JSON.stringify({ app: EXPORT_APP, version: SCHEMA_VERSION, data: decoded }),
    );
  } catch {
    throw new Error('密码错误，或备份文件已损坏');
  }
}
