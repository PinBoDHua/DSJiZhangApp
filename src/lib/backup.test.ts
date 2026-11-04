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
});
