import { describe, expect, it } from 'vitest';
import privacyPolicyHtml from '../../docs/privacy-policy.html?raw';
import { PRIVACY_VERSION } from './compliance';

/**
 * 隐私政策回归（审计 AND-01/AND-04）：
 * PRIVACY_VERSION 一 bump，政策页版本号、失效链接与崩溃诊断披露必须同步，否则上架政策页会再次不一致。
 */
describe('隐私政策与同意版本', () => {
  it('PRIVACY_VERSION 是 YYYY-MM-DD', () => {
    expect(PRIVACY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('政策页版本号与 PRIVACY_VERSION 同步', () => {
    expect(privacyPolicyHtml).toContain(`政策版本 ${PRIVACY_VERSION}`);
  });

  it('政策页不再包含失效的 GitHub Pages 在线链接', () => {
    expect(privacyPolicyHtml).not.toContain('pinbodhua.github.io');
  });

  it('政策页披露崩溃诊断只保存在本机应用私有目录', () => {
    expect(privacyPolicyHtml).toContain('崩溃诊断只保存在本机应用私有目录');
  });
});
