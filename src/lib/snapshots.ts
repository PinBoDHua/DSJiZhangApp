import type { AppState } from '../types';
import { round2 } from './money';
import { sumEntriesCapped } from './settlement';
import { fnv1aHex, sha256Hex } from './crypto';
import { validateImport } from './storage';

export type SnapshotReason =
  | 'auto-idle'
  | 'daily-open'
  | 'manual'
  | 'before-import'
  | 'before-restore'
  | 'before-clear'
  | 'before-undo-settlement';

export const SNAPSHOT_REASON_LABEL: Record<SnapshotReason, string> = {
  'auto-idle': '自动 · 空闲',
  'daily-open': '自动 · 每日',
  manual: '手动',
  'before-import': '导入前',
  'before-restore': '恢复前',
  'before-clear': '清空前',
  'before-undo-settlement': '撤销结算前',
};

export interface LedgerManifest {
  jobs: number;
  entries: number;
  restDays: number;
  advances: number;
  settlements: number;
  /** v1.2 起有周期规则时写入；旧快照 / 搬家包可缺省 */
  recurringRules?: number;
  hours: number;
  entryTotal: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface SnapshotMeta {
  id: string;
  at: string;
  reason: SnapshotReason;
  schema: number;
  hash: string;
  bytes: number;
  compressed: boolean;
  manifest: LedgerManifest;
}

interface SnapshotRecord extends SnapshotMeta {
  data: ArrayBuffer | string;
}

export interface ManifestDiffRow {
  key: keyof Omit<LedgerManifest, 'firstDate' | 'lastDate'>;
  label: string;
  before: number;
  after: number;
  unit: 'count' | 'hours' | 'money';
}

export const SNAPSHOT_MAX_COUNT = 30;
export const SNAPSHOT_MAX_BYTES = 30 * 1024 * 1024;

const DB_NAME = 'xinshi.snapshots';
const DB_VERSION = 1;
const STORE = 'snapshots';
const MANUAL_REASONS: SnapshotReason[] = [
  'manual',
  'before-import',
  'before-restore',
  'before-clear',
  'before-undo-settlement',
];

export function ledgerManifest(state: AppState): LedgerManifest {
  const dates = state.entries.map((entry) => entry.date).filter(Boolean).sort();
  const hours = round2(state.entries.reduce((sum, entry) => sum + (entry.hours || 0), 0));
  // 与首页 / 统计 / 结算使用同一口径（月薪封顶、同日日薪只计一次）。
  const entryTotal = sumEntriesCapped(state.entries).total;
  return {
    jobs: state.jobs.length,
    entries: state.entries.length,
    restDays: state.restDays.length,
    advances: state.advances.length,
    settlements: state.settlements.length,
    ...(state.recurringRules?.length
      ? { recurringRules: state.recurringRules.length }
      : {}),
    hours,
    entryTotal,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
  };
}

export function diffManifests(before: LedgerManifest, after: LedgerManifest): ManifestDiffRow[] {
  return [
    { key: 'jobs', label: '工作', before: before.jobs, after: after.jobs, unit: 'count' },
    { key: 'entries', label: '工记', before: before.entries, after: after.entries, unit: 'count' },
    { key: 'restDays', label: '休息', before: before.restDays, after: after.restDays, unit: 'count' },
    { key: 'advances', label: '借支', before: before.advances, after: after.advances, unit: 'count' },
    {
      key: 'settlements',
      label: '结算单',
      before: before.settlements,
      after: after.settlements,
      unit: 'count',
    },
    {
      key: 'recurringRules',
      label: '周期规则',
      before: before.recurringRules ?? 0,
      after: after.recurringRules ?? 0,
      unit: 'count',
    },
    { key: 'hours', label: '累计工时', before: before.hours, after: after.hours, unit: 'hours' },
    {
      key: 'entryTotal',
      label: '工记合计',
      before: before.entryTotal,
      after: after.entryTotal,
      unit: 'money',
    },
  ];
}

export async function stateHash(state: AppState): Promise<string> {
  const text = JSON.stringify(state);
  const sha = await sha256Hex(text);
  return (sha ?? fnv1aHex(text, 16)).slice(0, 16);
}

interface CompressedPayload {
  data: ArrayBuffer;
  compressed: boolean;
}

export async function compressPayload(text: string): Promise<CompressedPayload> {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') {
    return { data: bytes.buffer.slice(0) as ArrayBuffer, compressed: false };
  }
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const data = await new Response(stream).arrayBuffer();
    return { data, compressed: true };
  } catch {
    return { data: bytes.buffer.slice(0) as ArrayBuffer, compressed: false };
  }
}

export async function decompressPayload(record: SnapshotRecord): Promise<string> {
  if (!record.compressed) {
    if (typeof record.data === 'string') return record.data;
    return new TextDecoder().decode(record.data);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前环境无法解压本机快照');
  }
  const stream = new Blob([record.data]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/* 保留策略：纯函数，便于单测；不在里面碰 IndexedDB                    */
/* ------------------------------------------------------------------ */

function reasonGroup(reason: SnapshotReason): 'manual' | 'daily' | 'auto' {
  if (MANUAL_REASONS.includes(reason)) return 'manual';
  if (reason === 'daily-open') return 'daily';
  return 'auto';
}

export interface PrunePlanOptions {
  maxCount?: number;
  maxBytes?: number;
}

/**
 * 计算要删除的快照 id：
 * - 自动 10、每日每天 1 份保留最近 7 天、手动 5；
 * - 硬上限 30 份 / 30 MB，先删最旧的自动，再每日，最后手动；
 * - 永远不删最新的一份。
 */
export function planSnapshotPrune(
  metas: SnapshotMeta[],
  options: PrunePlanOptions = {},
): string[] {
  const maxCount = options.maxCount ?? SNAPSHOT_MAX_COUNT;
  const maxBytes = options.maxBytes ?? SNAPSHOT_MAX_BYTES;
  const sorted = [...metas].sort((a, b) => b.at.localeCompare(a.at));
  if (sorted.length <= 1) return [];

  const keep = new Set<string>();
  const manual = sorted.filter((meta) => reasonGroup(meta.reason) === 'manual').slice(0, 5);
  for (const meta of manual) keep.add(meta.id);

  const auto = sorted.filter((meta) => reasonGroup(meta.reason) === 'auto').slice(0, 10);
  for (const meta of auto) keep.add(meta.id);

  const days = new Set<string>();
  for (const meta of sorted) {
    if (reasonGroup(meta.reason) !== 'daily') continue;
    const day = meta.at.slice(0, 10);
    if (days.has(day)) continue;
    days.add(day);
    keep.add(meta.id);
    if (days.size >= 7) break;
  }

  // 如果保留集合为空（理论上不会），至少保留最新一条
  if (keep.size === 0) keep.add(sorted[0].id);

  const remove: string[] = sorted.filter((meta) => !keep.has(meta.id)).map((meta) => meta.id);
  const removed = new Set(remove);
  const removeOrder = [
    ...sorted.filter((meta) => reasonGroup(meta.reason) === 'auto').reverse(),
    ...sorted.filter((meta) => reasonGroup(meta.reason) === 'daily').reverse(),
    ...sorted.filter((meta) => reasonGroup(meta.reason) === 'manual').reverse(),
  ];

  let count = keep.size;
  let bytes = sorted
    .filter((meta) => keep.has(meta.id))
    .reduce((sum, meta) => sum + meta.bytes, 0);

  for (const meta of removeOrder) {
    if (count <= maxCount && bytes <= maxBytes) break;
    if (!keep.has(meta.id)) continue;
    if (meta.id === sorted[0].id) continue; // 保留最新
    keep.delete(meta.id);
    if (!removed.has(meta.id)) {
      removed.add(meta.id);
      remove.push(meta.id);
    }
    count -= 1;
    bytes -= meta.bytes;
  }

  return remove;
}

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

export function isSnapshotStoreAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  if (!isSnapshotStoreAvailable()) {
    return Promise.reject(new Error('当前环境不支持本机快照'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('at', 'at');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开快照存储失败'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('快照操作失败'));
  });
}

function toMeta(record: SnapshotRecord): SnapshotMeta {
  return {
    id: record.id,
    at: record.at,
    reason: record.reason,
    schema: record.schema,
    hash: record.hash,
    bytes: record.bytes,
    compressed: record.compressed,
    manifest: record.manifest,
  };
}

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const db = await openDb();
  try {
    const records = await requestResult<SnapshotRecord[]>(
      db.transaction(STORE, 'readonly').objectStore(STORE).getAll(),
    );
    return records.map(toMeta).sort((a, b) => b.at.localeCompare(a.at));
  } finally {
    db.close();
  }
}

export async function saveSnapshot(
  state: AppState,
  reason: SnapshotReason,
): Promise<{ meta: SnapshotMeta; pruned: number } | null> {
  const existing = await listSnapshots();
  const hash = await stateHash(state);
  // 安全类快照（导入/清空/恢复/撤销结算前）必须在手动保留组里有一份，不能被
  // 「最新快照内容相同」的自动快照顶掉：自动组轮转快，覆盖前恢复点可能先被删。
  // 手动组内同内容已存在才算重复，提示里的「已留快照」才成立。
  const isManual = MANUAL_REASONS.includes(reason);
  const duplicate = isManual
    ? existing.some((meta) => meta.hash === hash && MANUAL_REASONS.includes(meta.reason))
    : existing[0]?.hash === hash;
  if (duplicate) return null;

  const payload = await compressPayload(JSON.stringify(state));
  const meta: SnapshotMeta = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    reason,
    schema: state.version,
    hash,
    bytes: payload.data.byteLength,
    compressed: payload.compressed,
    manifest: ledgerManifest(state),
  };
  const record: SnapshotRecord = { ...meta, data: payload.data };

  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('保存快照失败'));
      tx.onabort = () => reject(tx.error ?? new Error('保存快照事务已中止'));
    });
    const after = [...existing, meta].sort((a, b) => b.at.localeCompare(a.at));
    const remove = planSnapshotPrune(after);
    if (remove.length > 0) {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const id of remove) store.delete(id);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('清理旧快照失败'));
      });
    }
    return { meta, pruned: remove.length };
  } finally {
    db.close();
  }
}

export async function readSnapshotState(id: string): Promise<AppState> {
  const db = await openDb();
  try {
    const record = await requestResult<SnapshotRecord | undefined>(
      db.transaction(STORE, 'readonly').objectStore(STORE).get(id),
    );
    if (!record) throw new Error('快照不存在，可能已被清理');
    const text = await decompressPayload(record);
    // 写入时存了 hash / bytes，读取时要用它验完整性：IndexedDB 被清理工具或
    // 其他脚本改过时，只要能通过结构校验就会被当成正常账本静默恢复。
    if (record.hash) {
      const candidates = new Set<string>([fnv1aHex(text, 16).slice(0, 16)]);
      const sha = await sha256Hex(text);
      if (sha) candidates.add(sha.slice(0, 16));
      if (!candidates.has(record.hash)) {
        throw new Error('快照已损坏，可能被清理工具修改，无法恢复');
      }
    }
    const parsed = JSON.parse(text) as unknown;
    return validateImport(
      JSON.stringify({ app: 'xinshi', version: record.schema, data: parsed }),
      { unlockOrphans: true },
    );
  } finally {
    db.close();
  }
}

export async function deleteSnapshots(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of ids) store.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('删除快照失败'));
    });
  } finally {
    db.close();
  }
}

export async function clearSnapshots(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('清空快照失败'));
    });
  } finally {
    db.close();
  }
}

export function snapshotTotalBytes(metas: SnapshotMeta[]): number {
  return metas.reduce((sum, meta) => sum + meta.bytes, 0);
}
