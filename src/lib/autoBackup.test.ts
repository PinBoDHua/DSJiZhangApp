import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_AUTO_BACKUP,
  autoBackupFileName,
  readAutoBackupSettings,
  runAutoBackup,
  shouldRunAutoBackup,
  writeAutoBackupSettings,
} from './autoBackup';
import { makeEntry, makeJob, makeState } from './testFixtures';

vi.mock('./native', () => ({
  isNativeApp: () => true,
  saveTextFile: vi.fn(async () => 'native' as const),
}));

vi.mock('./saveFile', () => ({
  pruneDownloadFiles: vi.fn(async () => 2),
}));

const { saveTextFile } = await import('./native');
const { pruneDownloadFiles } = await import('./saveFile');

const store = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, String(value)),
  removeItem: (key: string) => store.delete(key),
});

afterEach(() => {
  store.clear();
});

describe('自动备份设置与调度', () => {
  it('默认关闭，保留 14 份', () => {
    expect(readAutoBackupSettings()).toEqual(DEFAULT_AUTO_BACKUP);
    expect(readAutoBackupSettings().enabled).toBe(false);
  });

  it('写入时保留份数限制在 1–60', () => {
    writeAutoBackupSettings({ enabled: true, keep: 99 });
    expect(readAutoBackupSettings()).toMatchObject({ enabled: true, keep: 60 });
    writeAutoBackupSettings({ keep: 0 });
    expect(readAutoBackupSettings().keep).toBe(1);
  });

  it('默认关闭、网页端、空账本都不自动跑', () => {
    const state = makeState({ jobs: [makeJob()], entries: [makeEntry()] });
    expect(shouldRunAutoBackup(DEFAULT_AUTO_BACKUP, state)).toBe(false);
    expect(
      shouldRunAutoBackup({ enabled: true, keep: 14 }, state, { native: false }),
    ).toBe(false);
    expect(
      shouldRunAutoBackup({ enabled: true, keep: 14 }, makeState(), { native: true }),
    ).toBe(false);
  });

  it('同一天只跑一次，第二天再跑', () => {
    const state = makeState({ jobs: [makeJob()], entries: [makeEntry()] });
    const first = new Date(2026, 10, 5, 8, 0, 0);
    const sameDay = new Date(2026, 10, 5, 20, 0, 0);
    const nextDay = new Date(2026, 10, 6, 8, 0, 0);
    const settings = {
      enabled: true,
      keep: 14,
      lastRunAt: first.toISOString(),
    };
    expect(shouldRunAutoBackup(settings, state, { now: sameDay, native: true })).toBe(false);
    expect(shouldRunAutoBackup(settings, state, { now: nextDay, native: true })).toBe(true);
  });

  it('文件名包含日期和时分秒，同一天的备份不会互相覆盖', () => {
    expect(autoBackupFileName(new Date(2026, 10, 5, 8, 9, 10))).toBe(
      '薪时自动备份-20261105-080910.json',
    );
    expect(autoBackupFileName(new Date(2026, 10, 5, 20, 30, 40))).toBe(
      '薪时自动备份-20261105-203040.json',
    );
  });

  it('备份写入成功但清理旧文件失败时，仍算本次备份成功', async () => {
    writeAutoBackupSettings({ enabled: true, keep: 14 });
    vi.mocked(pruneDownloadFiles).mockRejectedValueOnce(new Error('媒体库繁忙'));
    const state = makeState({ jobs: [makeJob()], entries: [makeEntry()] });
    const result = await runAutoBackup(state, {
      native: true,
      now: new Date(2026, 10, 5, 8, 9, 10),
    });
    expect(result.ran).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.warning).toBe('媒体库繁忙');
    expect(vi.mocked(saveTextFile)).toHaveBeenCalledOnce();
    const settings = readAutoBackupSettings();
    expect(settings.lastRunAt).toBeTruthy();
    expect(settings.lastError).toBeUndefined();
  });
});
