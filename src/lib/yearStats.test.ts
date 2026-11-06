import { describe, expect, it } from 'vitest';
import type { Entry, PayRule } from '../types';
import { makeEntry, makeJob } from './testFixtures';
import { buildYearSummary, entriesInYear, shiftYear, yearPeriod } from './yearStats';

const rule = (overrides: Partial<PayRule> = {}): PayRule => ({
  payType: 'hourly',
  rate: 25,
  standardHours: 8,
  expectedDays: 22,
  monthlyMode: 'prorated',
  restDaysPerMonth: 0,
  restPolicy: 'quota',
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: false,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
  ...overrides,
});

function dayEntries(
  jobId: string,
  dates: string[],
  entryRule: PayRule,
  hours = 8,
): Entry[] {
  return dates.map((date, index) =>
    makeEntry({
      id: `${jobId}-${index}`,
      jobId,
      date,
      hours,
      rule: entryRule,
      createdAt: `${date}T10:00:00.000Z`,
    }),
  );
}

function datesInMonth(year: number, month: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return `${year}-${String(month).padStart(2, '0')}-${day}`;
  });
}

describe('年度区间', () => {
  it('按自然年取区间，闰年 2 月不越界', () => {
    expect(yearPeriod('2026-11-06')).toEqual({
      year: 2026,
      start: '2026-01-01',
      end: '2026-12-31',
      label: '2026年',
    });
    expect(yearPeriod('2028-02-29').end).toBe('2028-12-31');
  });

  it('可以向前 / 向后翻年', () => {
    const period = yearPeriod('2026-06-01');
    expect(shiftYear(period, -2).year).toBe(2024);
    expect(shiftYear(period, 1).start).toBe('2027-01-01');
  });

  it('只取当年的工记', () => {
    const entries = [makeEntry({ date: '2026-12-31' }), makeEntry({ date: '2027-01-01' })];
    expect(entriesInYear(entries, 2026).map((entry) => entry.date)).toEqual(['2026-12-31']);
  });
});

describe('年度汇总', () => {
  it('固定月薪按「岗位 × 月」封顶，12 个月柱状图之和等于年报', () => {
    const job = makeJob({ id: 'job-monthly', rule: rule({ payType: 'monthly', monthlyMode: 'fixed', rate: 3500, standardHours: 6 }) });
    const entries = [
      ...dayEntries('job-monthly', datesInMonth(2026, 1, 23), job.rule),
      ...dayEntries('job-monthly', datesInMonth(2026, 2, 22), job.rule),
    ];
    const summary = buildYearSummary(entries, 2026);
    expect(summary.totals.total).toBe(7000);
    expect(summary.months[0].earnings).toBe(3500);
    expect(summary.months[1].earnings).toBe(3500);
    expect(summary.months.slice(2).every((month) => month.earnings === 0)).toBe(true);
    expect(
      summary.months.reduce((sum, month) => sum + month.earnings, 0),
    ).toBe(summary.totals.total);
    expect(summary.breakdown[0]).toMatchObject({ jobId: 'job-monthly', total: 7000, days: 45 });
  });

  it('普通月薪按出勤折算，不超过整月月薪', () => {
    const job = makeJob({
      id: 'job-prorated',
      rule: rule({ payType: 'monthly', monthlyMode: 'prorated', rate: 7500 }),
    });
    const entries = dayEntries('job-prorated', datesInMonth(2026, 3, 10), job.rule);
    const summary = buildYearSummary(entries, 2026);
    expect(summary.months[2].earnings).toBe(3409.09);
    expect(summary.totals.total).toBe(3409.09);
  });

  it('时薪与日薪累加，跨岗位分布正确', () => {
    const hourly = makeJob({ id: 'job-hourly' });
    const daily = makeJob({
      id: 'job-daily',
      rule: rule({ payType: 'daily', rate: 320 }),
    });
    const entries = [
      ...dayEntries('job-hourly', ['2026-04-01', '2026-04-02'], hourly.rule),
      makeEntry({
        id: 'daily-1',
        jobId: 'job-daily',
        date: '2026-04-01',
        hours: 8,
        rule: daily.rule,
      }),
    ];
    const summary = buildYearSummary(entries, 2026);
    expect(summary.totals.total).toBe(720);
    expect(summary.totals.hours).toBe(24);
    expect(summary.totals.days).toBe(2);
    expect(summary.breakdown.map((item) => [item.jobId, item.total])).toEqual([
      ['job-hourly', 400],
      ['job-daily', 320],
    ]);
  });

  it('空年份返回 12 个零月份，不残留上一年数据', () => {
    const entries = dayEntries('job-hourly', ['2025-04-01'], rule());
    const summary = buildYearSummary(entries, 2026);
    expect(summary.totals.total).toBe(0);
    expect(summary.months).toHaveLength(12);
    expect(summary.months.every((month) => month.earnings === 0 && month.entries === 0)).toBe(true);
    expect(summary.breakdown).toEqual([]);
  });

  it('年度工时与出勤不会被月薪封顶影响', () => {
    const job = makeJob({ id: 'job-monthly', rule: rule({ payType: 'monthly', monthlyMode: 'fixed', rate: 3500, standardHours: 6 }) });
    const entries = dayEntries('job-monthly', datesInMonth(2026, 5, 22), job.rule, 6);
    const summary = buildYearSummary(entries, 2026);
    expect(summary.totals.total).toBe(3500);
    expect(summary.totals.hours).toBe(132);
    expect(summary.totals.days).toBe(22);
  });
});
