import type { Entry, Totals } from '../types';
import { pad2, parseISODate } from './date';
import { round2 } from './money';
import { sumEntriesCapped } from './settlement';

export interface YearPeriod {
  year: number;
  start: string;
  end: string;
  label: string;
}

export interface MonthPoint {
  month: number;
  /** 该月 1 日，便于图表与跳转 */
  date: string;
  label: string;
  entries: number;
  earnings: number;
  hours: number;
  days: number;
}

export interface JobYearTotal {
  jobId: string;
  total: number;
  hours: number;
  days: number;
}

export interface YearSummary {
  period: YearPeriod;
  totals: Totals;
  months: MonthPoint[];
  breakdown: JobYearTotal[];
}

const EMPTY_TOTALS: Totals = {
  base: 0,
  otPay: 0,
  bonus: 0,
  deduction: 0,
  total: 0,
  hours: 0,
  days: 0,
  otHours: 0,
  capAdjustment: 0,
};

/** 自然年区间；传入任意日期，取它所在的年份。 */
export function yearPeriod(iso: string): YearPeriod {
  const year = parseISODate(iso).getFullYear();
  return {
    year,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
    label: `${year}年`,
  };
}

export function shiftYear(period: YearPeriod, delta: number): YearPeriod {
  return yearPeriod(`${period.year + delta}-01-01`);
}

export function entriesInYear(entries: Entry[], year: number): Entry[] {
  const prefix = `${year}-`;
  return entries.filter((entry) => entry.date.startsWith(prefix));
}

/**
 * 年度汇总。
 * 收入口径与账本一致：按「岗位 × 月」分别套用月薪封顶，再按 12 个月累加；
 * 因此 12 个月柱状图之和 = 年度收入，不会出现图表加起来对不上总数的情况。
 */
export function buildYearSummary(entries: Entry[], year: number): YearSummary {
  const yearEntries = entriesInYear(entries, year);
  const totals: Totals = { ...EMPTY_TOTALS };
  const months: MonthPoint[] = [];
  const breakdown = new Map<string, JobYearTotal>();

  for (let month = 1; month <= 12; month += 1) {
    const monthKey = `${year}-${pad2(month)}`;
    const monthEntries = yearEntries.filter((entry) => entry.date.startsWith(monthKey));
    const monthTotals = sumEntriesCapped(monthEntries);
    totals.base = round2(totals.base + monthTotals.base);
    totals.otPay = round2(totals.otPay + monthTotals.otPay);
    totals.bonus = round2(totals.bonus + monthTotals.bonus);
    totals.deduction = round2(totals.deduction + monthTotals.deduction);
    totals.hours = round2(totals.hours + monthTotals.hours);
    totals.days += monthTotals.days;
    totals.otHours = round2(totals.otHours + monthTotals.otHours);
    totals.capAdjustment = round2(totals.capAdjustment + monthTotals.capAdjustment);
    totals.total = round2(totals.total + monthTotals.total);

    const byJob = new Map<string, Entry[]>();
    for (const entry of monthEntries) {
      const group = byJob.get(entry.jobId);
      if (group) group.push(entry);
      else byJob.set(entry.jobId, [entry]);
    }
    for (const [jobId, jobEntries] of byJob) {
      const jobTotals = sumEntriesCapped(jobEntries);
      const current = breakdown.get(jobId) ?? { jobId, total: 0, hours: 0, days: 0 };
      current.total = round2(current.total + jobTotals.total);
      current.hours = round2(current.hours + jobTotals.hours);
      current.days += jobTotals.days;
      breakdown.set(jobId, current);
    }

    months.push({
      month,
      date: `${year}-${pad2(month)}-01`,
      label: `${month}月`,
      entries: monthEntries.length,
      earnings: monthTotals.total,
      hours: monthTotals.hours,
      days: monthTotals.days,
    });
  }

  totals.days = Math.round(totals.days);
  totals.total = round2(
    totals.base + totals.otPay + totals.bonus - totals.deduction,
  );

  return {
    period: yearPeriod(`${year}-01-01`),
    totals,
    months,
    breakdown: Array.from(breakdown.values()).sort((a, b) => b.total - a.total),
  };
}
