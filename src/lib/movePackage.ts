import type { AppState } from '../types';
import { APP_VERSION } from './compliance';
import {
  digestText,
  base64ToBytes,
  bytesToBase64,
  deriveAesKey,
  randomBytes,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  IV_BYTES,
} from './crypto';
import { ledgerManifest, type LedgerManifest } from './snapshots';
import { EXPORT_APP, SCHEMA_VERSION, validateImport } from './storage';

export const MOVE_FORMAT = 'move';
export const MOVE_FORMAT_VERSION = 1;

export interface MoveSource {
  appVersion: string;
  platform: 'android' | 'web';
}

export interface EncryptedMovePayload {
  alg: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

export interface PlainMovePayload {
  plain: AppState;
}

export type MovePayload = EncryptedMovePayload | PlainMovePayload;

export interface MovePackageHeader {
  app: typeof EXPORT_APP;
  format: typeof MOVE_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  source: MoveSource;
  manifest: LedgerManifest;
  checksum: string;
  passwordHint?: string;
  payload: MovePayload;
}

export interface MoveBuildOptions {
  password?: string;
  passwordHint?: string;
  now?: Date;
  platform?: 'android' | 'web';
}

export interface MoveUnlockResult {
  state: AppState;
  header: MovePackageHeader;
  encrypted: boolean;
}

function currentPlatform(): 'android' | 'web' {
  if (typeof window === 'undefined') return 'web';
  const capacitor = (
    window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
  ).Capacitor;
  return capacitor?.isNativePlatform?.() ? 'android' : 'web';
}

function checksumInput(header: Pick<MovePackageHeader, 'schemaVersion' | 'manifest' | 'payload'>) {
  return JSON.stringify({
    schemaVersion: header.schemaVersion,
    manifest: header.manifest,
    payload: header.payload,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseManifest(value: unknown): LedgerManifest {
  if (!isRecord(value)) throw new Error('搬家包缺少清单');
  const numbers = ['jobs', 'entries', 'restDays', 'advances', 'settlements', 'hours', 'entryTotal'];
  for (const key of numbers) {
    if (asNumber(value[key]) === null) throw new Error('搬家包清单格式不正确');
  }
  return {
    jobs: value.jobs as number,
    entries: value.entries as number,
    restDays: value.restDays as number,
    advances: value.advances as number,
    settlements: value.settlements as number,
    hours: value.hours as number,
    entryTotal: value.entryTotal as number,
    firstDate: typeof value.firstDate === 'string' ? value.firstDate : null,
    lastDate: typeof value.lastDate === 'string' ? value.lastDate : null,
  };
}

function parseHeader(value: unknown): MovePackageHeader {
  if (!isRecord(value)) throw new Error('搬家包不是有效的 JSON 对象');
  if (value.app !== EXPORT_APP) throw new Error('这不是薪时的文件');
  if (value.format !== MOVE_FORMAT) throw new Error('不是搬家包格式');
  const formatVersion = asNumber(value.formatVersion);
  if (formatVersion !== MOVE_FORMAT_VERSION) {
    throw new Error('搬家包格式版本不受支持，请升级薪时');
  }
  const schemaVersion = asNumber(value.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion === null || schemaVersion < 1) {
    throw new Error('搬家包缺少数据版本');
  }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error('搬家包来自更新版本的薪时，请升级后再导入');
  }
  const exportedAt = asString(value.exportedAt);
  if (!exportedAt) throw new Error('搬家包缺少导出时间');
  if (!isRecord(value.source)) throw new Error('搬家包缺少来源信息');
  const source: MoveSource = {
    appVersion: asString(value.source.appVersion) ?? '',
    platform: value.source.platform === 'android' ? 'android' : 'web',
  };
  const manifest = parseManifest(value.manifest);
  const checksum = asString(value.checksum);
  if (!checksum || !/^(sha256|fnv1a):[0-9a-f]+$/i.test(checksum)) {
    throw new Error('搬家包缺少校验码');
  }
  if (!isRecord(value.payload)) throw new Error('搬家包缺少数据内容');
  const payload = value.payload as unknown as MovePayload;
  if ('plain' in payload) {
    if (!isRecord(payload.plain)) throw new Error('搬家包数据格式不正确');
  } else {
    if (
      payload.alg !== 'AES-GCM' ||
      payload.kdf !== 'PBKDF2-SHA256' ||
      !Number.isInteger(payload.iterations) ||
      payload.iterations < 100_000 ||
      payload.iterations > 1_000_000 ||
      typeof payload.salt !== 'string' ||
      typeof payload.iv !== 'string' ||
      typeof payload.data !== 'string'
    ) {
      throw new Error('搬家包加密参数不正确');
    }
  }
  const passwordHint =
    typeof value.passwordHint === 'string' ? value.passwordHint.slice(0, 40) : undefined;
  return {
    app: EXPORT_APP,
    format: MOVE_FORMAT,
    formatVersion: MOVE_FORMAT_VERSION,
    schemaVersion,
    exportedAt,
    source,
    manifest,
    checksum,
    passwordHint,
    payload,
  };
}

export function isMovePackage(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) && parsed.app === EXPORT_APP && parsed.format === MOVE_FORMAT;
  } catch {
    return false;
  }
}

export function parseMovePackage(text: string): MovePackageHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  return parseHeader(parsed);
}

async function verifyChecksum(header: MovePackageHeader): Promise<void> {
  const [alg, expected] = header.checksum.split(':', 2);
  if (alg !== 'sha256' && alg !== 'fnv1a') throw new Error('搬家包校验算法不受支持');
  const actual = await digestText(checksumInput(header));
  if (actual.alg !== alg) {
    throw new Error('当前环境无法验证该搬家包的校验码');
  }
  if (actual.hex.toLowerCase() !== expected.toLowerCase()) {
    throw new Error('搬家包校验失败，文件可能已损坏或被修改');
  }
}

export async function buildMovePackage(
  state: AppState,
  options: MoveBuildOptions = {},
): Promise<{ text: string; header: MovePackageHeader }> {
  const password = options.password?.trim() ?? '';
  if (password && password.length < 6) throw new Error('搬家包密码至少 6 位');
  const manifest = ledgerManifest(state);
  const schemaVersion = state.version ?? SCHEMA_VERSION;
  let payload: MovePayload;
  if (password) {
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(state)),
    );
    payload = {
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(ciphertext)),
    };
  } else {
    payload = { plain: state };
  }
  const withoutChecksum = {
    schemaVersion,
    manifest,
    payload,
  };
  const digest = await digestText(checksumInput(withoutChecksum));
  const header: MovePackageHeader = {
    app: EXPORT_APP,
    format: MOVE_FORMAT,
    formatVersion: MOVE_FORMAT_VERSION,
    schemaVersion,
    exportedAt: (options.now ?? new Date()).toISOString(),
    source: {
      appVersion: APP_VERSION,
      platform: options.platform ?? currentPlatform(),
    },
    manifest,
    checksum: `${digest.alg}:${digest.hex}`,
    passwordHint: options.passwordHint?.trim().slice(0, 40) || undefined,
    payload,
  };
  return { text: JSON.stringify(header, null, 2), header };
}

export async function unlockMovePackage(
  text: string,
  password?: string,
): Promise<MoveUnlockResult> {
  const header = parseMovePackage(text);
  await verifyChecksum(header);

  let state: AppState;
  if ('plain' in header.payload) {
    state = validateImport(
      JSON.stringify({
        app: EXPORT_APP,
        version: header.schemaVersion,
        data: header.payload.plain,
      }),
    );
  } else {
    if (!password) throw new Error('这个搬家包需要密码');
    try {
      const salt = base64ToBytes(header.payload.salt);
      const iv = base64ToBytes(header.payload.iv);
      const data = base64ToBytes(header.payload.data);
      const key = await deriveAesKey(password, salt, header.payload.iterations);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
      state = validateImport(
        JSON.stringify({ app: EXPORT_APP, version: header.schemaVersion, data: decoded }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes('升级')) throw error;
      throw new Error('密码错误，或搬家包已损坏');
    }
  }

  const actual = ledgerManifest(state);
  const expected = header.manifest;
  const countsMatch =
    actual.jobs === expected.jobs &&
    actual.entries === expected.entries &&
    actual.restDays === expected.restDays &&
    actual.advances === expected.advances &&
    actual.settlements === expected.settlements &&
    actual.firstDate === expected.firstDate &&
    actual.lastDate === expected.lastDate;
  const amountsMatch =
    Math.abs(actual.hours - expected.hours) <= 0.011 &&
    Math.abs(actual.entryTotal - expected.entryTotal) <= 0.011;
  if (!countsMatch || !amountsMatch) {
    throw new Error('包内清单与内容不一致，文件可能已损坏');
  }

  return { state, header, encrypted: !('plain' in header.payload) };
}

export function moveFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `薪时搬家包-${date}-${time}.json`;
}

/** 只在界面展示用：sha256:abcd… → abcd… */
export function shortChecksum(checksum: string): string {
  const [, hex = ''] = checksum.split(':', 2);
  return hex.slice(0, 8).toUpperCase();
}
