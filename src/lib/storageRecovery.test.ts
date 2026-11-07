import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_STORAGE_KEYS, loadStateDetailed, STORAGE_KEY } from './storage';
import { createEmptyState } from './storage';

class MemoryStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes.push(key); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

afterEach(() => vi.unstubAllGlobals());

describe('本地账本损坏保护', () => {
  it('主账本损坏时不回退旧键、不写空数据，并保留原文', () => {
    const storage = new MemoryStorage();
    storage.values.set(STORAGE_KEY, '{broken');
    storage.values.set(LEGACY_STORAGE_KEYS[0], JSON.stringify(createEmptyState('旧账本')));
    vi.stubGlobal('localStorage', storage);
    const result = loadStateDetailed();
    expect(result.state).toBeNull();
    expect(result.failure).toMatchObject({ key: STORAGE_KEY, raw: '{broken' });
    expect(storage.writes).toEqual([]);
  });

  it('未来版本账本停止启动且不清空', () => {
    const storage = new MemoryStorage();
    const raw = JSON.stringify({ app: 'xinshi', version: 8, data: createEmptyState('未来') });
    storage.values.set(STORAGE_KEY, raw);
    vi.stubGlobal('localStorage', storage);
    const result = loadStateDetailed();
    expect(result.failure?.raw).toBe(raw);
    expect(result.failure?.message).toContain('更新版本');
    expect(storage.values.get(STORAGE_KEY)).toBe(raw);
    expect(storage.writes).toEqual([]);
  });

  it('没有账本时正常返回空状态标记', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    expect(loadStateDetailed()).toEqual({ state: null, failure: null });
  });
});
