import { describe, expect, it } from 'vitest';
import { createEmptyState } from './storage';
import { decryptBackup, encryptBackup, isEncryptedBackup } from './backup';

describe('加密备份', () => {
  it('密码正确时完整还原状态', async () => {
    const state = createEmptyState('加密用户');
    state.onboardingDone = true;
    const text = await encryptBackup(state, 'correct horse 123');
    expect(isEncryptedBackup(text)).toBe(true);
    expect(text).not.toContain('加密用户');
    const restored = await decryptBackup(text, 'correct horse 123');
    expect(restored.profile.name).toBe('加密用户');
    expect(restored.version).toBe(7);
  });

  it('密码错误时拒绝解密', async () => {
    const text = await encryptBackup(createEmptyState('A'), 'right-password');
    await expect(decryptBackup(text, 'wrong-password')).rejects.toThrow('密码错误');
  });

  it('密文被篡改时拒绝解密', async () => {
    const text = await encryptBackup(createEmptyState('A'), 'right-password');
    const envelope = JSON.parse(text);
    envelope.data = `${envelope.data.slice(0, -4)}AAAA`;
    await expect(decryptBackup(JSON.stringify(envelope), 'right-password')).rejects.toThrow(
      '密码错误',
    );
  });

  it('普通 JSON 不会被识别为加密备份', () => {
    expect(isEncryptedBackup('{"app":"xinshi","version":3,"data":{}}')).toBe(false);
    expect(isEncryptedBackup('not json')).toBe(false);
  });

  it('拒绝全空白密码，且密码首尾空格规则一致', async () => {
    await expect(encryptBackup(createEmptyState('A'), '      ')).rejects.toThrow('至少 6 位');
    const text = await encryptBackup(createEmptyState('A'), '  right-password  ');
    const restored = await decryptBackup(text, 'right-password');
    expect(restored.profile.name).toBe('A');
  });

  it('未来版本加密备份明确拒绝', async () => {
    const envelope = JSON.parse(await encryptBackup(createEmptyState('A'), 'right-password'));
    envelope.version = 8;
    await expect(decryptBackup(JSON.stringify(envelope), 'right-password')).rejects.toThrow('更新版本');
  });

  it('密码正确但账本结构损坏时，报结构错误而非密码错误', async () => {
    const state = createEmptyState('A');
    (state as { entries: unknown }).entries = 'broken';
    const text = await encryptBackup(state, 'right-password');
    await expect(decryptBackup(text, 'right-password')).rejects.toThrow('备份缺少工作或工记数据');
  });
});
