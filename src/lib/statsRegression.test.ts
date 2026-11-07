import { describe, expect, it } from 'vitest';
import { dailySeries, sumEntriesCapped } from './settlement';
import { baseRule, makeEntry } from './testFixtures';
import { periodOf } from './date';

const fixedRule = {
  ...baseRule,
  payType: 'monthly' as const,
  rate: 3500,
  expectedDays: 22,
  monthlyMode: 'fixed' as const,
  otEnabled: false,
};

describe('统计金额回归', () => {
  it('固定月薪本月图表之和等于 3500，同日多段也不重复', () => {
    const entries = [
      makeEntry({ id: 'm1', date: '2026-11-02', rule: fixedRule }),
      makeEntry({ id: 'm2', date: '2026-11-03', rule: fixedRule }),
      makeEntry({ id: 'm3', date: '2026-11-03', createdAt: '2026-11-03T13:00:00.000Z', rule: fixedRule }),
    ];
    const period = periodOf('monthly', '2026-11-10');
    const series = dailySeries(entries, period.start, period.end);
    expect(series.reduce((sum, point) => sum + point.earnings, 0)).toBe(3500);
    expect(sumEntriesCapped(entries).total).toBe(3500);
  });

  it('同月调价按每天快照折算，不用月末新价覆盖旧工记', () => {
    const oldRule = { ...baseRule, payType: 'monthly' as const, rate: 1000, otEnabled: false };
    const newRule = { ...oldRule, rate: 2000 };
    const entries = [
      makeEntry({ id: 'old', date: '2026-11-02', rule: oldRule, createdAt: '2026-11-02T08:00:00.000Z' }),
      makeEntry({ id: 'new', date: '2026-11-03', rule: newRule, createdAt: '2026-11-03T08:00:00.000Z' }),
    ];
    expect(sumEntriesCapped(entries).base).toBe(136.36);
    const period = periodOf('monthly', '2026-11-10');
    const chart = dailySeries(entries, period.start, period.end).reduce((sum, point) => sum + point.earnings, 0);
    expect(chart).toBe(136.36);
  });

  it('固定月薪非整月图表仍按周期出勤折算', () => {
    const entries = [
      makeEntry({ id: 'a', date: '2026-11-03', rule: fixedRule }),
      makeEntry({ id: 'b', date: '2026-11-04', rule: fixedRule }),
    ];
    const series = dailySeries(entries, '2026-11-03', '2026-11-04');
    expect(series.reduce((sum, point) => sum + point.earnings, 0)).toBe(318.18);
  });
});
