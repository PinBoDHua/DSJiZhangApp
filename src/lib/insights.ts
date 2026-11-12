import type { Entry } from '../types';
import { addDays, startOfWeek, todayISO, weekdayShort } from './date';
import { round2 } from './money';
import { payForEntry } from './pay';
import { dailyBaseEntryIds } from './settlement';

export interface HeatDay {
  date: string;
  label: string;
  hours: number;
  earnings: number;
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  isFuture: boolean;
}

export interface HeatWeek {
  start: string;
  days: HeatDay[];
}

export interface Heatmap {
  weeks: HeatWeek[];
  totalHours: number;
  totalEarnings: number;
  maxHours: number;
}

function levelFor(hours: number, maxHours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0) return 0;
  if (maxHours <= 0) return 0;
  const ratio = hours / maxHours;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** 最近 N 周（含本周）的每日工时热力图；周起始日跟随设置。 */
export function buildHeatmap(
  entries: Entry[],
  options: { today?: string; weeks?: number; weekStartsOn?: 0 | 1 } = {},
): Heatmap {
  const today = options.today ?? todayISO();
  const weeksCount = options.weeks ?? 12;
  const weekStartsOn = options.weekStartsOn ?? 1;
  const currentWeekStart = startOfWeek(today, weekStartsOn);
  const firstWeekStart = addDays(currentWeekStart, -(weeksCount - 1) * 7);
  const byDate = new Map<string, { hours: number; earnings: number }>();
  // 与统计 / 结算同一套「同一天多段只计一次基础工资」规则；earnings 是逐日折算参考，
  // 不套月薪封顶（图表只展示工时，金额字段不参与账目口径）。
  const baseIds = dailyBaseEntryIds(entries);
  for (const entry of entries) {
    const current = byDate.get(entry.date) ?? { hours: 0, earnings: 0 };
    const pay = payForEntry(entry);
    const payType = entry.rule.payType;
    const perDayBase = payType === 'daily' || payType === 'monthly';
    const includeBase = !perDayBase || baseIds.has(entry.id);
    current.hours += entry.hours || 0;
    current.earnings += pay.total - (includeBase ? 0 : pay.base);
    byDate.set(entry.date, current);
  }

  const rawDays: HeatDay[] = [];
  for (let index = 0; index < weeksCount * 7; index += 1) {
    const date = addDays(firstWeekStart, index);
    const totals = byDate.get(date);
    const hours = round2(totals?.hours ?? 0);
    rawDays.push({
      date,
      label: weekdayShort(date),
      hours,
      earnings: round2(totals?.earnings ?? 0),
      level: 0,
      isToday: date === today,
      isFuture: date > today,
    });
  }

  const maxHours = rawDays.reduce((max, day) => Math.max(max, day.hours), 0);
  for (const day of rawDays) day.level = levelFor(day.hours, maxHours);

  const weeks: HeatWeek[] = [];
  for (let week = 0; week < weeksCount; week += 1) {
    weeks.push({
      start: addDays(firstWeekStart, week * 7),
      days: rawDays.slice(week * 7, week * 7 + 7),
    });
  }

  return {
    weeks,
    totalHours: round2(rawDays.reduce((sum, day) => sum + day.hours, 0)),
    totalEarnings: round2(rawDays.reduce((sum, day) => sum + day.earnings, 0)),
    maxHours,
  };
}

/** 两条记录之间简单对比的百分比；用于首页「比上周」提示。 */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function heatmapAriaLabel(heatmap: Heatmap): string {
  return `最近 ${heatmap.weeks.length} 周工时热力图，共 ${heatmap.totalHours} 小时`;
}
