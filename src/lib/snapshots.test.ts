import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotMeta } from './snapshots';
import {
  compressPayload,
  decompressPayload,
  diffManifests,
  ledgerManifest,
  planSnapshotPrune,
  saveSnapshot,
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createSnapshotIndexedDb(existing: any[] = []) {
  const putCalled = deferred();
  const putSucceeded = deferred();
  let writeTx: any = null;
  let putCalls = 0;
  const db = {
    close: vi.fn(),
    transaction: (_store: string, mode: IDBTransactionMode) => {
      if (mode === 'readonly') {
        return {
          objectStore: () => ({
            getAll: () => {
              const request: any = { result: existing, error: null };
              queueMicrotask(() => request.onsuccess?.());
              return request;
            },
          }),
        };
      }
      writeTx = { error: null };
      writeTx.objectStore = () => ({
        put: () => {
          putCalls += 1;
          const request: any = { result: undefined, error: null };
          putCalled.resolve();
          queueMicrotask(() => {
            request.onsuccess?.();
            putSucceeded.resolve();
          });
          return request;
        },
      });
      return writeTx;
    },
  };
  return {
    factory: {
      open: () => {
        const request: any = { result: db, error: null };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    } as unknown as IDBFactory,
    putCalled: putCalled.promise,
    putSucceeded: putSucceeded.promise,
    getPutCalls: () => putCalls,
    complete: () => writeTx?.oncomplete?.(),
    fail: () => {
      writeTx.error = new Error('模拟事务写入失败');
      writeTx.onerror?.();
    },
    abort: () => {
      writeTx.error = new Error('模拟事务中止');
      writeTx.onabort?.();
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

  it('快照清单中的同日日薪不重复计算', () => {
    const rule = { ...makeJob().rule, payType: 'daily' as const, rate: 300, otEnabled: false };
    const manifest = ledgerManifest(
      makeState({
        entries: [
          makeEntry({ id: 'daily-a', hours: 4, rule }),
          makeEntry({ id: 'daily-b', hours: 3, rule }),
        ],
      }),
    );
    expect(manifest.entryTotal).toBe(300);
    expect(manifest.hours).toBe(7);
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

describe('快照写入事务', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('put 成功后仍等待事务完成才返回', async () => {
    const idb = createSnapshotIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    let settled = false;
    const saving = saveSnapshot(makeState(), 'manual');
    void saving.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await idb.putSucceeded;
    await Promise.resolve();
    expect(settled).toBe(false);
    idb.complete();
    await expect(saving).resolves.toMatchObject({ pruned: 0 });
  });

  it('事务 error 会拒绝保存', async () => {
    const idb = createSnapshotIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const saving = saveSnapshot(makeState(), 'manual');
    await idb.putCalled;
    idb.fail();
    await expect(saving).rejects.toThrow('模拟事务写入失败');
  });

  it('put 成功后事务中止仍会拒绝保存', async () => {
    const idb = createSnapshotIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    const saving = saveSnapshot(makeState(), 'manual');
    await idb.putSucceeded;
    idb.abort();
    await expect(saving).rejects.toThrow('模拟事务中止');
  });
});

describe('快照去重语义', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const state = makeState({ jobs: [makeJob()] });

  function existingRecord(id: string, reason: SnapshotMeta['reason'], hash: string) {
    return {
      ...meta(id, '2026-11-05T12:00:00.000Z', reason),
      hash,
      data: new ArrayBuffer(0),
    };
  }

  it('自动快照与最新快照同 hash 时跳过，不写事务', async () => {
    const hash = await stateHash(state);
    const idb = createSnapshotIndexedDb([existingRecord('latest', 'manual', hash)]);
    vi.stubGlobal('indexedDB', idb.factory);

    await expect(saveSnapshot(state, 'auto-idle')).resolves.toBeNull();
    expect(idb.getPutCalls()).toBe(0);
  });

  it('自动组已有同 hash 时手动/安全快照仍会写入', async () => {
    const hash = await stateHash(state);
    for (const reason of ['manual', 'before-import'] as const) {
      const idb = createSnapshotIndexedDb([existingRecord('auto-1', 'auto-idle', hash)]);
      vi.stubGlobal('indexedDB', idb.factory);

      const saving = saveSnapshot(state, reason);
      await idb.putSucceeded;
      idb.complete();
      const result = await saving;

      expect(result).not.toBeNull();
      expect(result?.meta.reason).toBe(reason);
      expect(result?.meta.hash).toBe(hash);
      expect(result?.pruned).toBe(0);
      expect(idb.getPutCalls()).toBe(1);
    }
  });

  it('手动组已有同 hash 时手动快照跳过写入', async () => {
    const hash = await stateHash(state);
    const idb = createSnapshotIndexedDb([
      existingRecord('manual-1', 'before-undo-settlement', hash),
    ]);
    vi.stubGlobal('indexedDB', idb.factory);

    await expect(saveSnapshot(state, 'manual')).resolves.toBeNull();
    expect(idb.getPutCalls()).toBe(0);
  });

  it('每日快照按自动组语义只与最新快照比较', async () => {
    const hash = await stateHash(state);
    const idb = createSnapshotIndexedDb([existingRecord('manual-latest', 'manual', hash)]);
    vi.stubGlobal('indexedDB', idb.factory);

    await expect(saveSnapshot(state, 'daily-open')).resolves.toBeNull();
    expect(idb.getPutCalls()).toBe(0);
  });
});
