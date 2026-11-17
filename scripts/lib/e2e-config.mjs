/**
 * e2e / 截图脚本共享配置（AND-06）。
 * - 隐私同意版本从 src/lib/compliance.ts 读取，PRIVACY_VERSION 一 bump 全链自动跟随；
 * - preview 地址与浏览器路径可用环境变量覆盖，默认值与历史脚本保持一致。
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readPrivacyVersion() {
  const source = readFileSync(join(ROOT, 'src', 'lib', 'compliance.ts'), 'utf8');
  const match = source.match(/export const PRIVACY_VERSION\s*=\s*'([^']+)'/);
  if (!match) {
    throw new Error('无法从 src/lib/compliance.ts 解析 PRIVACY_VERSION');
  }
  return match[1];
}

/** 当前隐私同意版本（与 src/lib/compliance.ts 同源）。 */
export const PRIVACY_VERSION = readPrivacyVersion();

/** preview 服务地址；默认 http://127.0.0.1:4173，可用 E2E_BASE_URL 覆盖。 */
export const E2E_BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';

/** Chromium 可执行文件；默认沿用历史 Edge x86 路径，可用 E2E_BROWSER_PATH 覆盖。 */
export const E2E_BROWSER_PATH =
  process.env.E2E_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** 给 page / context 预置隐私同意，避免版本 bump 后 e2e 卡在隐私弹窗。 */
export async function seedPrivacyConsent(pageOrContext) {
  if (!pageOrContext || typeof pageOrContext.addInitScript !== 'function') {
    throw new Error('seedPrivacyConsent 需要 playwright 的 page 或 context 对象');
  }
  await pageOrContext.addInitScript(
    (version) => localStorage.setItem('xinshi.privacyConsent', version),
    PRIVACY_VERSION,
  );
}
