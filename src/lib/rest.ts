import type { RestDay } from '../types';

/** 单条休息记录折算天数：只有明确 0.5 才按半天；缺省按整天，0 / 负数（异常导入）按 0 计。 */
export function restDayAmount(rest: Pick<RestDay, 'days'>): number {
  if (rest.days === undefined) return 1;
  if (!Number.isFinite(rest.days) || rest.days <= 0) return 0;
  return rest.days === 0.5 ? 0.5 : 1;
}

/** 休息记录合计天数，保留一位小数（0.1 步进，不是 0.5 步进）。 */
export function totalRestDays(rests: Array<Pick<RestDay, 'days'>>): number {
  const total = rests.reduce((sum, rest) => sum + restDayAmount(rest), 0);
  return Math.round(total * 10) / 10;
}

export function formatRestDays(value: number): string {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
