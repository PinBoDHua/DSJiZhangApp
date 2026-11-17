import type { AppState } from '../types';
import { APP_VERSION } from './compliance';
import {
  digestText,
  fnv1aHex,
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
/**
 * 校验码口径版本：
 * - 1（旧包缺省）：对 JSON.stringify 原文（依赖键序）计算，读包时继续兼容；
 * - 2：递归排序键后重建再计算，第三方工具重排键序后不会误判成「已损坏」。
 */
export const MOVE_CHECKSUM_VERSION = 2;

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
  /** 校验码口径版本；旧包缺省按 1 处理 */
  checksumVersion?: number;
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

/** 递归排序对象键后重建 JSON：新口径的校验码不再依赖原始键序。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }
  if (isRecord(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return (
      '{' +
      keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}

function checksumInput(
  header: Pick<MovePackageHeader, 'schemaVersion' | 'manifest' | 'payload'>,
  canonical = false,
): string {
  const core = {
    schemaVersion: header.schemaVersion,
    manifest: header.manifest,
    payload: header.payload,
  };
  return canonical ? canonicalJson(core) : JSON.stringify(core);
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
  if (value.recurringRules !== undefined && asNumber(value.recurringRules) === null) {
    throw new Error('搬家包周期规则清单格式不正确');
  }
  return {
    jobs: value.jobs as number,
    entries: value.entries as number,
    restDays: value.restDays as number,
    advances: value.advances as number,
    settlements: value.settlements as number,
    recurringRules:
      value.recurringRules === undefined ? undefined : (value.recurringRules as number),
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
  let checksumVersion: number | undefined;
  if (value.checksumVersion !== undefined) {
    const parsed = asNumber(value.checksumVersion);
    if (parsed === null || !Number.isInteger(parsed) || parsed < 1) {
      throw new Error('搬家包校验算法版本不正确');
    }
    checksumVersion = parsed;
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
    checksumVersion,
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

async function digestHex(input: string, alg: 'sha256' | 'fnv1a'): Promise<string> {
  if (alg === 'fnv1a') {
    // fnv1a 包来自不支持 SHA-256 的旧环境；新设备必须仍按原算法校验，
    // 否则旧→新搬家会被「当前环境无法验证」卡死。
    return fnv1aHex(input, 16);
  }
  const digest = await digestText(input);
  if (digest.alg !== 'sha256') throw new Error('当前环境无法验证该搬家包的校验码');
  return digest.hex;
}

async function verifyChecksum(header: MovePackageHeader): Promise<void> {
  const [alg, expected] = header.checksum.split(':', 2);
  if (alg !== 'sha256' && alg !== 'fnv1a') throw new Error('搬家包校验算法不受支持');
  // 新口径只按排序键校验；旧包（缺 version 字段）先按旧口径、再尝试新口径，
  // 这样被第三方 sort_keys 重排过的旧包也不会被误判成损坏。
  const inputs =
    (header.checksumVersion ?? 1) >= MOVE_CHECKSUM_VERSION
      ? [checksumInput(header, true)]
      : [checksumInput(header, false), checksumInput(header, true)];
  for (const input of inputs) {
    const actualHex = await digestHex(input, alg);
    if (actualHex.toLowerCase() === expected.toLowerCase()) return;
  }
  throw new Error('搬家包校验失败，文件可能已损坏或被修改');
}

export async function buildMovePackage(
  state: AppState,
  options: MoveBuildOptions = {},
): Promise<{ text: string; header: MovePackageHeader }> {
  const rawPassword = options.password;
  const password = rawPassword?.trim() ?? '';
  // 传了密码却只有空格时不能静默导出明文包，否则界面会误报“已加密”。
  if (rawPassword !== undefined && rawPassword.length > 0 && password.length === 0) {
    throw new Error('搬家包密码不能全是空格；不设密码请留空');
  }
  if (password && password.length < 6) throw new Error('搬家包密码至少 6 位');
  // 清单必须按“导入时同一套规范化规则”重算：否则像 standardHours 被夹到 0.5 这类
  // 规范化差异会让 App 自己导出的包在导入时被判成“清单与内容不一致”。
  const canonical = validateImport(
    JSON.stringify({ app: EXPORT_APP, version: SCHEMA_VERSION, data: state }),
    { unlockOrphans: true },
  );
  const manifest = ledgerManifest(canonical);
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
  const digest = await digestText(checksumInput(withoutChecksum, true));
  const header: MovePackageHeader = {
    app: EXPORT_APP,
    format: MOVE_FORMAT,
    formatVersion: MOVE_FORMAT_VERSION,
    checksumVersion: MOVE_CHECKSUM_VERSION,
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
      { unlockOrphans: true },
    );
  } else {
    if (!password?.trim()) throw new Error('这个搬家包需要密码');
    let decoded: unknown;
    try {
      const salt = base64ToBytes(header.payload.salt);
      const iv = base64ToBytes(header.payload.iv);
      const data = base64ToBytes(header.payload.data);
      const key = await deriveAesKey(password.trim(), salt, header.payload.iterations);
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
      decoded = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      throw new Error('密码错误，或搬家包已损坏');
    }
    // 解密成功后的结构校验错误原样上抛，不再误报「密码错误」让用户反复试密码。
    state = validateImport(
      JSON.stringify({ app: EXPORT_APP, version: header.schemaVersion, data: decoded }),
      { unlockOrphans: true },
    );
  }

  const actual = ledgerManifest(state);
  const expected = header.manifest;
  const countsMatch =
    actual.jobs === expected.jobs &&
    actual.entries === expected.entries &&
    actual.restDays === expected.restDays &&
    actual.advances === expected.advances &&
    actual.settlements === expected.settlements &&
    (expected.recurringRules === undefined ||
      (actual.recurringRules ?? 0) === expected.recurringRules) &&
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
