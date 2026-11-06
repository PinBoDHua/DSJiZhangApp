import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';
import { APP_VERSION } from './version';
import { APP_VERSION as COMPLIANCE_VERSION } from './compliance';

describe('应用版本号', () => {
  it('与 package.json 保持一致（构建时由 Vite 注入）', () => {
    expect(APP_VERSION).toBe(packageJson.version);
  });

  it('合规 / 搬家包引用的版本与 UI 同源', () => {
    expect(COMPLIANCE_VERSION).toBe(APP_VERSION);
  });
});
