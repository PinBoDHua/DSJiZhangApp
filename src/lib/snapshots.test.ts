import { describe, expect, it } from 'vitest';
import type { SnapshotMeta } from './snapshots';
import {
  compressPayload,
  decompressPayload,
  diffManifests,
  ledgerManifest,
  planSnapshotPrune,
  stateHash,
} from './snapshots';
import { makeEntry, makeJob, makeSettlement, makeState } from './testFixtures';

function meta(
  id: string,
  at: string,
  reason: SnapshotMeta['reason'],
  bytes = 100,
): SnapshotMeta {
  return {
    id,
    at,
    reason,
    schema: 7,
    hash: id,
    bytes,
    compressed: true,
    manifest: {
      jobs: 1,
      entries: 1,
      restDays: 0,
      advances: 0,
      settlements: 0,
      hours: 8,
      entryTotal: 200,
      firstDate: '2026-11-02',
      lastDate: '2026-11-02',
    },
  };
}

describe('账本清单与差异', () => {
  it('统计工作、工记、工时与工记合计', () => {
    const entry = makeEntry();
    const state = makeState({
      jobs: [makeJob()],
      entries: [entry],
      settlements: [makeSettlement({ entryIds: [entry.id] })],
    });
    const manifest = ledgerManifest(state);
    expect(manifest.jobs).toBe(1);
    expect(manifest.entries).toBe(1);
    expect(manifest.settlements).toBe(1);
    expect(manifest.hours).toBe(8);
    expect(manifest.entryTotal).toBe(200);
    expect(manifest.firstDate).toBe('2026-11-02');
    expect(manifest.lastDate).toBe('2026-11-02');
  });

  it('差异按条数与金额给出前后值', () => {
    const before = ledgerManifest(makeState());
    const after = ledgerManifest(
      makeState({ jobs: [makeJob()], entries: [makeEntry(), makeEntry({ id: 'entry-2' })] }),
    );
    const rows = diffManifests(before, after);
    expect(rows.find((row) => row.key === 'entries')).toMatchObject({
      before: 0,
      after: 2,
    });
    expect(rows.find((row) => row.key === 'hours')?.after).toBe(16);
    expect(rows.find((row) => row.key === 'entryTotal')?.after).toBe(400);
  });

  it('相同状态哈希稳定，不同状态哈希变化', async () => {
    const state = makeState({ jobs: [makeJob()] });
    const a = await stateHash(state);
    const b = await stateHash(state);
    const c = await stateHash({ ...state, profile: { ...state.profile, name: '另一个人' } });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe('快照压缩', () => {
  it('压缩后可以还原完整文本', async () => {
    const text = JSON.stringify({ note: '薪时快照', values: [1, 2, 3] });
    const payload = await compressPayload(text);
    const restored = await decompressPayload({
      ...meta('snap-1', '2026-11-05T10:00:00.000Z', 'manual'),
      data: payload.data,
      compressed: payload.compressed,
    });
    expect(restored).toBe(text);
  });

  it('未压缩的快照也能还原', async () => {
    const text = 'plain payload';
    const record = {
      ...meta('snap-2', '2026-11-05T10:00:00.000Z', 'manual'),
      data: new TextEncoder().encode(text).buffer as ArrayBuffer,
      compressed: false,
    };
    await expect(decompressPayload(record)).resolves.toBe(text);
  });
});

describe('快照保留策略', () => {
  it('自动快照保留最新 10 个', () => {
    const metas = Array.from({ length: 15 }, (_, index) =>
      meta(
        `auto-${index}`,
        `2026-11-05T10:${String(index).padStart(2, '0')}:00.000Z`,
        'auto-idle',
      ),
    );
    const remove = planSnapshotPrune(metas);
    expect(remove).toHaveLength(5);
    expect(remove).toContain('auto-0');
    expect(remove).toContain('auto-4');
    expect(remove).not.toContain('auto-14');
  });

  it('每日快照每天只留一份，保留最近 7 天', () => {
    const metas = Array.from({ length: 10 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return meta(`daily-${index}`, `2026-11-${day}T08:00:00.000Z`, 'daily-open');
    });
    const remove = planSnapshotPrune(metas);
    expect(remove).toHaveLength(3);
    expect(remove).toContain('daily-0');
    expect(remove).toContain('daily-1');
    expect(remove).toContain('daily-2');
  });

  it('手动快照保留最新 5 个', () => {
    const metas = Array.from({ length: 7 }, (_, index) =>
      meta(`manual-${index}`, `2026-11-05T10:0${index}:00.000Z`, 'manual'),
    );
    const remove = planSnapshotPrune(metas);
    expect(remove).toHaveLength(2);
    expect(remove).not.toContain('manual-6');
  });

  it('总容量超限时先删除最旧的自动快照', () => {
    const metas = Array.from({ length: 10 }, (_, index) =>
      meta(`auto-${index}`, `2026-11-05T10:${String(index).padStart(2, '0')}:00.000Z`, 'auto-idle'),
    );
    const remove = planSnapshotPrune(metas, { maxBytes: 300 });
    expect(remove).toHaveLength(7);
    expect(remove).toContain('auto-0');
    expect(remove).not.toContain('auto-9');
  });

  it('硬上限下不会删除最新一份', () => {
    const metas = [
      meta('newest', '2026-11-05T12:00:00.000Z', 'manual'),
      ...Array.from({ length: 9 }, (_, index) =>
        meta(`old-${index}`, `2026-11-05T0${index}:00:00.000Z`, 'auto-idle'),
      ),
    ];
    const remove = planSnapshotPrune(metas, { maxCount: 1 });
    expect(remove).not.toContain('newest');
    expect(remove).toHaveLength(9);
  });
});
