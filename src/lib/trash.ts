import type { AppState, Job, TrashKind } from '../types';
import { formatDateShort, formatTimeRange, weekdayCN } from './date';
import { round2 } from './money';
import { payForEntry } from './pay';

export const TRASH_RETENTION_DAYS = 30;
/** 每一类最多留多少条，防止回收站把存储空间吃掉 */
export const TRASH_CAP_PER_KIND = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

const KIND_LABELS: Record<TrashKind, string> = {
  job: '工作',
  entry: '工记',
  rest: '休息',
  advance: '借支',
};

export interface TrashRow {
  key: string;
  kind: TrashKind;
  /** 原记录 ID，恢复时按它回查 */
  id: string;
  jobId: string | null;
  date: string | null;
  title: string;
  subtitle: string;
  deletedAt: string;
  remainingDays: number;
  /** 金额损失预览；工作 / 休息没有金额 */
  amount: number | null;
  hours: number | null;
  restDays: number | null;
  /** 工记是否带考勤照片（照片本体仍在本机） */
  hasPhoto?: boolean;
}

export function trashKindLabel(kind: TrashKind): string {
  return KIND_LABELS[kind];
}

export function trashRemainingDays(deletedAt: string, now = Date.now()): number {
  const deleted = Date.parse(deletedAt);
  if (!Number.isFinite(deleted)) return 0;
  const age = Math.max(0, now - deleted);
  return Math.max(0, TRASH_RETENTION_DAYS - Math.floor(age / DAY_MS));
}

export function purgeExpiredTrash<T extends { deletedAt: string }>(
  items: T[],
  now = Date.now(),
): T[] {
  return items.filter((item) => {
    const deleted = Date.parse(item.deletedAt);
    if (!Number.isFinite(deleted)) return false;
    return now - deleted < TRASH_RETENTION_DAYS * DAY_MS;
  });
}

/** 新删除的排前面，并按类型限量 */
export function pushTrash<T extends { deletedAt: string }>(
  list: T[],
  item: T,
  idOf: (value: T) => string,
  cap = TRASH_CAP_PER_KIND,
): T[] {
  const limit = Math.max(0, cap);
  if (limit === 0) return [];
  const rest = list.filter((value) => idOf(value) !== idOf(item));
  return rest.length >= limit ? [item, ...rest.slice(0, limit - 1)] : [item, ...rest];
}

export function limitTrash<T extends { deletedAt: string }>(
  items: T[],
  cap = TRASH_CAP_PER_KIND,
): T[] {
  const limit = Math.max(0, cap);
  const sorted = [...items].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return sorted.slice(0, limit);
}

function jobName(jobs: Map<string, Job>, jobId: string): string {
  return jobs.get(jobId)?.name ?? '已删除的工作';
}

function noteTail(note?: string): string {
  const text = note?.trim();
  if (!text) return '';
  return text.length > 20 ? `${text.slice(0, 20)}…` : text;
}

export function buildTrashRows(state: AppState, now = Date.now()): TrashRow[] {
  const jobs = new Map<string, Job>();
  for (const job of state.jobs) jobs.set(job.id, job);
  for (const item of state.trashedJobs) {
    if (!jobs.has(item.job.id)) jobs.set(item.job.id, item.job);
  }

  const rows: TrashRow[] = [];

  for (const item of state.trashedEntries) {
    const entry = item.entry;
    const range = formatTimeRange(entry.startTime, entry.endTime);
    rows.push({
      key: `entry:${entry.id}`,
      kind: 'entry',
      id: entry.id,
      jobId: entry.jobId,
      date: entry.date,
      title: `${formatDateShort(entry.date)} ${weekdayCN(entry.date)}`,
      subtitle: [
        jobName(jobs, entry.jobId),
        entry.rule.payType === 'piece'
          ? `${round2(entry.quantity)} ${entry.rule.unitLabel}`
          : `${round2(entry.hours)} 小时`,
        range,
        noteTail(entry.note),
      ]
        .filter(Boolean)
        .join(' · '),
      deletedAt: item.deletedAt,
      remainingDays: trashRemainingDays(item.deletedAt, now),
      amount: payForEntry(entry).total,
      hours: round2(entry.hours || 0),
      restDays: null,
      hasPhoto: Boolean(entry.photoId),
    });
  }

  for (const item of state.trashedRests) {
    const restDay = item.restDay;
    rows.push({
      key: `rest:${restDay.id}`,
      kind: 'rest',
      id: restDay.id,
      jobId: restDay.jobId,
      date: restDay.date,
      title: `${formatDateShort(restDay.date)} ${weekdayCN(restDay.date)}`,
      subtitle: [
        jobName(jobs, restDay.jobId),
        restDay.days === 0.5 ? '半天休息' : '整天休息',
        noteTail(restDay.note),
      ]
        .filter(Boolean)
        .join(' · '),
      deletedAt: item.deletedAt,
      remainingDays: trashRemainingDays(item.deletedAt, now),
      amount: null,
      hours: null,
      restDays: restDay.days === 0.5 ? 0.5 : 1,
    });
  }

  for (const item of state.trashedAdvances) {
    const advance = item.advance;
    rows.push({
      key: `advance:${advance.id}`,
      kind: 'advance',
      id: advance.id,
      jobId: advance.jobId,
      date: advance.date,
      title: `${formatDateShort(advance.date)} 借支`,
      subtitle: [jobName(jobs, advance.jobId), noteTail(advance.note)].filter(Boolean).join(' · '),
      deletedAt: item.deletedAt,
      remainingDays: trashRemainingDays(item.deletedAt, now),
      amount: round2(advance.amount || 0),
      hours: null,
      restDays: null,
    });
  }

  for (const item of state.trashedJobs) {
    rows.push({
      key: `job:${item.job.id}`,
      kind: 'job',
      id: item.job.id,
      jobId: item.job.id,
      date: null,
      title: item.job.name,
      subtitle: [item.job.employer, '空工作'].filter(Boolean).join(' · '),
      deletedAt: item.deletedAt,
      remainingDays: trashRemainingDays(item.deletedAt, now),
      amount: null,
      hours: null,
      restDays: null,
    });
  }

  return rows.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export function summarizeTrash(rows: TrashRow[]): {
  count: number;
  amount: number;
  hours: number;
  restDays: number;
} {
  let amount = 0;
  let hours = 0;
  let restDays = 0;
  for (const row of rows) {
    amount += row.amount ?? 0;
    hours += row.hours ?? 0;
    restDays += row.restDays ?? 0;
  }
  return { count: rows.length, amount: round2(amount), hours: round2(hours), restDays: round2(restDays) };
}

/** 类型 + 工作两个条件同时生效；'all' 表示不限制 */
export function filterTrashRows(
  rows: TrashRow[],
  kind: 'all' | TrashKind,
  jobId: 'all' | string,
): TrashRow[] {
  return rows.filter(
    (row) =>
      (kind === 'all' || row.kind === kind) &&
      (jobId === 'all' || row.jobId === jobId),
  );
}

/** 恢复前告诉用户为什么不行，避免只丢一句「恢复失败」 */
export function trashRestoreBlockReason(row: TrashRow, state: AppState): string | null {
  if (row.kind === 'job') return null;
  const jobId = row.jobId;
  const date = row.date;
  if (!jobId) return '这条记录没有对应工作，无法恢复';
  if (!date) return '这条记录缺少日期，无法恢复';
  if (!state.jobs.some((job) => job.id === jobId)) {
    return state.trashedJobs.some((item) => item.job.id === jobId)
      ? '原工作还在回收站，先恢复工作'
      : '原工作已彻底删除，无法恢复';
  }

  const settled = state.settlements.some(
    (settlement) =>
      settlement.jobId === jobId &&
      date >= settlement.periodStart &&
      date <= settlement.periodEnd,
  );
  if (settled) return '这段时间已结算，先撤销结算再恢复';

  if (row.kind === 'entry') {
    if (state.entries.some((entry) => entry.id === row.id)) return null;
    if (state.restDays.some((rest) => rest.jobId === jobId && rest.date === date)) {
      return '这天已有休息，先取消休息再恢复';
    }
    const sameDay = state.entries
      .filter((entry) => entry.date === date)
      .reduce((sum, entry) => sum + (entry.hours || 0), 0);
    if (sameDay + (row.hours ?? 0) > 24) return '这天合计会超过 24 小时';
  }

  if (row.kind === 'rest') {
    if (state.restDays.some((rest) => rest.id === row.id)) return null;
    if (state.entries.some((entry) => entry.jobId === jobId && entry.date === date)) {
      return '这天已有工记，休息和工记只能留一个';
    }
    if (state.restDays.some((rest) => rest.jobId === jobId && rest.date === date)) {
      return '这天已排了休息';
    }
  }

  return null;
}
