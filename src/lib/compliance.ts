/**
 * 上架合规相关的常量与本地同意状态。
 * 隐私政策更新时递增 PRIVACY_VERSION，旧同意会失效并重新弹窗。
 */

export { APP_VERSION } from './version';
export const PRIVACY_VERSION = '2026-11-05';
export const PRIVACY_CONSENT_KEY = 'xinshi.privacyConsent';

const env = import.meta.env as Record<string, string | undefined>;

/** 商店隐私政策页地址；可用 VITE_PRIVACY_URL 覆盖。 */
export const PRIVACY_URL =
  env.VITE_PRIVACY_URL || 'https://pinbodhua.github.io/DSJiZhangApp/privacy-policy.html';

/** 支持邮箱；上线前用 VITE_SUPPORT_EMAIL 换成真实邮箱。 */
export const SUPPORT_EMAIL = env.VITE_SUPPORT_EMAIL || 'support@xinshi.app';

export function readPrivacyConsent(): string | null {
  try {
    return localStorage.getItem(PRIVACY_CONSENT_KEY);
  } catch {
    return null;
  }
}

export function hasPrivacyConsent(): boolean {
  return readPrivacyConsent() === PRIVACY_VERSION;
}

export function grantPrivacyConsent(): void {
  try {
    localStorage.setItem(PRIVACY_CONSENT_KEY, PRIVACY_VERSION);
  } catch {
    // 本地存储不可用时，本次会话仍然可以继续使用
  }
}

export function revokePrivacyConsent(): void {
  try {
    localStorage.removeItem(PRIVACY_CONSENT_KEY);
  } catch {
    // 忽略
  }
}
