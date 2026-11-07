import type { Entry, PayType } from '../types';
import { monthKey } from './date';
import { PAY_TYPE_LABEL } from './meta';
import { round2 } from './money';
import { sumEntries, sumEntriesCapped } from './settlement';

export interface PayTypeStat {
  payType: PayType;
  label: string;
  total: number;
  hours: number;
  days: number;
  count: number;
}

/**
 * 按计薪类型汇总收入。月薪在「岗位 × 自然月」内封顶，
 * 不能把多份工作或多个月合并后只封顶一次。
 */
export function payTypeBreakdown(entries: Entry[], capMonthly: boolean): PayTypeStat[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = capMonthly
      ? `${entry.rule.payType}|${entry.jobId}|${monthKey(entry.date)}`
      : entry.rule.payType;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const totals = new Map<PayType, Omit<PayTypeStat, 'days' | 'label'>>();
  const dates = new Map<PayType, Set<string>>();
  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const payType = first.rule.payType;
    const sum = capMonthly ? sumEntriesCapped(group) : sumEntries(group);
    const current = totals.get(payType) ?? { payType, total: 0, hours: 0, count: 0 };
    current.total = round2(current.total + sum.total);
    current.hours = round2(current.hours + sum.hours);
    current.count += group.length;
    totals.set(payType, current);
    const days = dates.get(payType) ?? new Set<string>();
    for (const entry of group) days.add(entry.date);
    dates.set(payType, days);
  }

  return Array.from(totals.values())
    .map((item) => ({
      ...item,
      label: PAY_TYPE_LABEL[item.payType],
      days: dates.get(item.payType)?.size ?? 0,
    }))
    .sort((a, b) => b.total - a.total);
}
