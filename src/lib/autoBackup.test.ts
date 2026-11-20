import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_BACKUP_FAILURE_KEY,
  DEFAULT_AUTO_BACKUP,
  autoBackupFileName,
  readAutoBackupFailure,
  readAutoBackupSettings,
  runAutoBackup,
  shouldRunAutoBackup,
  writeAutoBackupSettings,
} from './autoBackup';
import { backupDueText, markBackedUp } from './backupStatus';
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

  it('旧系统走分享面板时不算完成：不推进 lastRunAt、不清失败记录，下次仍会重试', async () => {
    // 预置「上次成功」和「同一自然日的失败退避（count 未到 3，仍允许再跑）」。
    writeAutoBackupSettings({
      enabled: true,
      keep: 14,
      lastError: '上次备份失败',
      lastFile: '薪时自动备份-旧文件.json',
    });
    globalThis.localStorage.setItem(
      AUTO_BACKUP_FAILURE_KEY,
      JSON.stringify({ date: '2026-11-06', count: 2, lastError: '原生桥超时' }),
    );
    vi.mocked(saveTextFile).mockResolvedValueOnce('shared');
    vi.mocked(pruneDownloadFiles).mockClear();
    const state = makeState({ jobs: [makeJob()], entries: [makeEntry()] });
    const now = new Date(2026, 10, 6, 9, 0, 0);
    const result = await runAutoBackup(state, { native: true, now });

    expect(result.ran).toBe(true);
    expect(result.warning).toContain('分享面板');
    expect(result.path).toBeTruthy();
    // 没真正落盘：不能把 14 天备份提醒重置为“刚备份过”。
    expect(globalThis.localStorage.getItem('xinshi.lastBackup')).toBeNull();
    // 未确认落盘 = 本轮未完成：lastRunAt 不推进（当天下一轮仍会重试），也不改上次成功文件。
    const settings = readAutoBackupSettings();
    expect(settings.lastRunAt).toBeUndefined();
    expect(settings.lastFile).toBe('薪时自动备份-旧文件.json');
    // 上次失败与失败退避都要保留，不能因为弹过分享面板就当成成功清零。
    expect(settings.lastError).toBe('上次备份失败');
    expect(readAutoBackupFailure()).toEqual({
      date: '2026-11-06',
      count: 2,
      lastError: '原生桥超时',
    });
    // 新文件还没确认写入时不应清理旧备份，否则会白减备份份数。
    expect(vi.mocked(pruneDownloadFiles)).not.toHaveBeenCalled();
    // 当天重新打开 App：仍要再试一次（不再被 lastRunAt 挡掉）。
    expect(
      shouldRunAutoBackup(readAutoBackupSettings(), state, {
        native: true,
        now: new Date(2026, 10, 6, 12, 0, 0),
      }),
    ).toBe(true);

    // 下一轮原生落盘成功：才推进 lastRunAt、清掉上次失败并清零退避。
    vi.mocked(saveTextFile).mockResolvedValueOnce('native');
    const next = await runAutoBackup(state, {
      native: true,
      now: new Date(2026, 10, 6, 12, 0, 0),
    });
    expect(next.ran).toBe(true);
    const retried = readAutoBackupSettings();
    expect(retried.lastRunAt).toBe(new Date(2026, 10, 6, 12, 0, 0).toISOString());
    expect(retried.lastError).toBeUndefined();
    expect(readAutoBackupFailure()).toBeNull();
    expect(globalThis.localStorage.getItem('xinshi.lastBackup')).toBeTruthy();
  });

  it('原生桥连续失败 3 次后当天停止重试，次日自动恢复并清零记录', async () => {
    writeAutoBackupSettings({ enabled: true, keep: 14 });
    // 模拟 saveFile 的 45s 超时：runAutoBackup 必须释放 running 单例，否则后续不再重试。
    vi.mocked(saveTextFile).mockRejectedValue(new Error('保存文件超时，请重试'));
    const state = makeState({ jobs: [makeJob()], entries: [makeEntry()] });
    const day = new Date(2026, 10, 7, 9, 0, 0);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await runAutoBackup(state, { native: true, now: day });
      expect(result.ran).toBe(false);
      expect(result.error).toContain('超时');
    }
    expect(readAutoBackupFailure()).toMatchObject({ date: '2026-11-07', count: 3 });

    // 当天不再重试：不应再次调用原生桥。
    const callsBefore = vi.mocked(saveTextFile).mock.calls.length;
    const blocked = await runAutoBackup(state, {
      native: true,
      now: new Date(2026, 10, 7, 18, 0, 0),
    });
    expect(blocked.ran).toBe(false);
    expect(blocked.error).toBeUndefined();
    expect(vi.mocked(saveTextFile).mock.calls.length).toBe(callsBefore);

    // 次日恢复，成功后失败记录清零。
    vi.mocked(saveTextFile).mockResolvedValue('native');
    const nextDay = await runAutoBackup(state, {
      native: true,
      now: new Date(2026, 10, 8, 9, 0, 0),
    });
    expect(nextDay.ran).toBe(true);
    expect(readAutoBackupFailure()).toBeNull();
  });

  it('失败退避只影响同一自然日', () => {
    const state = makeState({ jobs: [makeJob()], entries: [makeEntry()] });
    globalThis.localStorage.setItem(
      AUTO_BACKUP_FAILURE_KEY,
      JSON.stringify({ date: '2026-11-07', count: 9, lastError: '挂起' }),
    );
    const settings = { enabled: true, keep: 14 };
    expect(
      shouldRunAutoBackup(settings, state, { native: true, now: new Date(2026, 10, 7, 12, 0, 0) }),
    ).toBe(false);
    expect(
      shouldRunAutoBackup(settings, state, { native: true, now: new Date(2026, 10, 8, 12, 0, 0) }),
    ).toBe(true);
  });

  it('24 小时内备份的提醒文案不再写“今天”', () => {
    markBackedUp(new Date());
    const state = makeState({ jobs: [makeJob()], entries: [makeEntry()] });
    expect(backupDueText(state)).toBe('24 小时内已备份');
  });
});
