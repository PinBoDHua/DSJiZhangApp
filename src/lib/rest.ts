import type { RestDay } from '../types';

/** 单条休息记录折算天数：只有明确 0.5 才按半天，其他都按整天。 */
export function restDayAmount(rest: Pick<RestDay, 'days'>): number {
  return rest.days === 0.5 ? 0.5 : 1;
}

/** 休息记录合计天数，按 0.5 步进四舍五入。 */
export function totalRestDays(rests: Array<Pick<RestDay, 'days'>>): number {
  const total = rests.reduce((sum, rest) => sum + restDayAmount(rest), 0);
  return Math.round(total * 10) / 10;
}

export function formatRestDays(value: number): string {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
