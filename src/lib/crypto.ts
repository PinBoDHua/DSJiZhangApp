/**
 * 加密与摘要工具：加密备份、搬家包共用同一套参数，避免两套安全配置。
 * 只在需要时调用 WebCrypto；不可用时由调用方降级。
 */

export const PBKDF2_ITERATIONS = 250_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function assertCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持加密，请用较新的浏览器或系统 WebView');
  }
  return globalThis.crypto.subtle;
}

export function hasStrongCrypto(): boolean {
  return Boolean(globalThis.crypto?.subtle);
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function deriveAesKey(
  password: string,
  salt: Uint8Array,
  iterations = PBKDF2_ITERATIONS,
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

/** SHA-256 十六进制；环境不支持时返回 null，由调用方选择弱校验。 */
export async function sha256Hex(text: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** FNV-1a 32 位十六进制，用于弱环境去重 / 校验，不是安全哈希。 */
export function fnv1aHex(text: string, length = 8): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, Math.max(1, length));
}

/** 摘要文本：返回带算法前缀的字符串，便于以后升级。 */
export async function digestText(text: string): Promise<{ alg: 'sha256' | 'fnv1a'; hex: string }> {
  const sha = await sha256Hex(text);
  if (sha) return { alg: 'sha256', hex: sha };
  return { alg: 'fnv1a', hex: fnv1aHex(text, 16) };
}
