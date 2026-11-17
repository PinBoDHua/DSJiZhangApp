import { describe, expect, it } from 'vitest';
import type { AppState } from '../types';
import { isRemoteDirty, replayUpdaters } from './stateMerge';
import { makeEntry, makeJob, makeState } from './testFixtures';

function addEntry(entryId: string) {
  return (previous: AppState): AppState => ({
    ...previous,
    entries: [makeEntry({ id: entryId }), ...previous.entries],
  });
}

describe('replayUpdaters 跨标签页乐观合并', () => {
  it('远端已含另一标签页的新工记，本地更新再记一笔：两笔都在', () => {
    // 远端（另一标签页已落盘）：工作 + 工记 remote
    const remote = makeState({
      jobs: [makeJob()],
      entries: [makeEntry({ id: 'entry-remote' })],
    });
    // 本窗口的内存账本：还没看到远端那笔，只多了本地一笔 local
    const local = makeState({
      jobs: [makeJob()],
      entries: [makeEntry({ id: 'entry-local' })],
    });
    const pending = [addEntry('entry-local')];

    const merged = replayUpdaters(remote, pending);

    expect(merged.entries.map((entry) => entry.id).sort()).toEqual([
      'entry-local',
      'entry-remote',
    ]);
    // 合并基准是远端：不能把本地旧账（local）整包写回去
    expect(merged.jobs).toEqual(remote.jobs);
    expect(merged).not.toBe(local);
  });

  it('多个更新按提交顺序重放，后者能看到前者的结果', () => {
    const remote = makeState();
    const pending = [
      (previous: AppState) => ({ ...previous, profile: { ...previous.profile, name: '第一次' } }),
      (previous: AppState) => ({
        ...previous,
        profile: { ...previous.profile, name: previous.profile.name + '→第二次' },
      }),
    ];
    expect(replayUpdaters(remote, pending).profile.name).toBe('第一次→第二次');
  });

  it('没有待落盘更新时原样返回远端账本', () => {
    const remote = makeState({ jobs: [makeJob()] });
    expect(replayUpdaters(remote, [])).toBe(remote);
  });
});

describe('isRemoteDirty 乐观 CAS 判定', () => {
  it('远端为空时按「无冲突」处理（首次落盘）', () => {
    expect(isRemoteDirty(null, null)).toBe(false);
    expect(isRemoteDirty(null, '{"version":7}')).toBe(false);
  });

  it('远端原文与本窗口上次写入一致时不合并（避免重复重放）', () => {
    expect(isRemoteDirty('{"version":7}', '{"version":7}')).toBe(false);
  });

  it('远端原文被别的标签页改写后才判定为脏', () => {
    expect(isRemoteDirty('{"version":7,"entries":[]}', null)).toBe(true);
    expect(isRemoteDirty('{"version":7,"entries":[1]}', '{"version":7,"entries":[]}')).toBe(true);
  });
});
