import type { Entry, RestDay, Settlement } from '../types';

/** 同一天多份工作合计的工时上限 */
export const MAX_DAY_HOURS = 24;

/** 某天已记录的工时；编辑时排除自身 */
export function dayHours(entries: Entry[], date: string, excludeId?: string): number {
  return entries
    .filter((entry) => entry.date === date && entry.id !== excludeId)
    .reduce((sum, entry) => sum + (entry.hours || 0), 0);
}

/** 新增 / 改期后是否会超过同一天 24 小时上限 */
export function wouldExceedDayLimit(
  entries: Entry[],
  date: string,
  hours: number,
  excludeId?: string,
): boolean {
  if (!(hours > 0)) return false;
  return dayHours(entries, date, excludeId) + hours > MAX_DAY_HOURS + 1e-9;
}

/** 同岗位同一天是否已有休息 */
export function findRestOnDay(
  restDays: RestDay[],
  jobId: string,
  date: string,
): RestDay | undefined {
  return restDays.find((rest) => rest.jobId === jobId && rest.date === date);
}

/**
 * 结算周期是否与已有结算重叠。实现用 <= 判共享边界日：日结「同一天」周期必须能检出重复结算，
 * 因此不能改成严格 <（导入的任意区间单共享边界日也会被判重叠，属保守拦截）。
 */
export function findSettlementOverlap(
  settlements: Settlement[],
  jobId: string,
  period: { start: string; end: string },
): Settlement | undefined {
  return settlements.find(
    (settlement) =>
      settlement.jobId === jobId &&
      settlement.periodStart <= period.end &&
      period.start <= settlement.periodEnd,
  );
}
