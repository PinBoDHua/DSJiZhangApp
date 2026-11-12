import { describe, expect, it } from 'vitest';
import { dailySeries, sumEntries, sumEntriesCapped } from './settlement';
import { baseRule, makeEntry } from './testFixtures';
import { periodOf } from './date';
import { buildHeatmap } from './insights';
import { round2 } from './money';

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

  it('窗口外同月记录不稀释窗口内图表金额（整月出勤超 expectedDays 触发封顶时）', () => {
    const entries = Array.from({ length: 25 }, (_, index) =>
      makeEntry({
        id: `out-${index}`,
        date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        rule: fixedRule,
      }),
    );
    const series = dailySeries(entries, '2026-11-03', '2026-11-04');
    expect(series.reduce((sum, point) => sum + point.earnings, 0)).toBe(318.18);
  });

  it('月薪同一天多段也只计一次基础工资，周统计与热力图口径一致', () => {
    const monthlyRule = {
      ...baseRule,
      payType: 'monthly' as const,
      rate: 2200,
      expectedDays: 22,
      monthlyMode: 'prorated' as const,
      otEnabled: false,
    };
    const entries = [
      makeEntry({ id: 'm-a', date: '2026-11-03', hours: 4, rule: monthlyRule }),
      makeEntry({
        id: 'm-b',
        date: '2026-11-03',
        hours: 4,
        createdAt: '2026-11-03T13:00:00.000Z',
        rule: monthlyRule,
      }),
    ];
    expect(sumEntries(entries).base).toBe(100);
    expect(sumEntries(entries).hours).toBe(8);
    expect(sumEntriesCapped(entries).base).toBe(100);
    expect(buildHeatmap(entries, { today: '2026-11-10', weeks: 4 }).totalEarnings).toBe(100);
    expect(
      dailySeries(entries, '2026-11-03', '2026-11-03').reduce(
        (sum, point) => sum + point.earnings,
        0,
      ),
    ).toBe(100);
  });

  it('时薪同一天多段仍逐笔计薪，不受去重影响', () => {
    const entries = [
      makeEntry({ id: 'h-a', date: '2026-11-03', hours: 4, rule: baseRule }),
      makeEntry({ id: 'h-b', date: '2026-11-03', hours: 4, rule: baseRule }),
    ];
    expect(sumEntries(entries).base).toBe(200);
    expect(sumEntriesCapped(entries).base).toBe(200);
  });

  it('同月调价时固定月薪按每日快照折算，不再按整月发放', () => {
    const before = { ...baseRule, payType: 'monthly' as const, rate: 3500, expectedDays: 22, monthlyMode: 'fixed' as const, otEnabled: false };
    const after = { ...before, rate: 4000 };
    const entries = [
      ...Array.from({ length: 13 }, (_, index) =>
        makeEntry({
          id: `raise-old-${index}`,
          date: `2026-11-${String(index + 1).padStart(2, '0')}`,
          rule: before,
        }),
      ),
      ...Array.from({ length: 9 }, (_, index) =>
        makeEntry({
          id: `raise-new-${index}`,
          date: `2026-11-${String(index + 14).padStart(2, '0')}`,
          rule: after,
        }),
      ),
    ];
    // 按每日快照折算：13 天 × 3500/22 + 9 天 × 4000/22，整套规则的月薪封顶取最高月薪。
    expect(sumEntriesCapped(entries).base).toBe(3704.55);
    expect(sumEntriesCapped(entries).capAdjustment).toBe(0);
  });

  it('月薪整月图表之和精确等于合计，不因逐日舍入漂移', () => {
    const highFixed = { ...fixedRule, rate: 10000 };
    const entries = Array.from({ length: 22 }, (_, index) =>
      makeEntry({
        id: `full-${index}`,
        date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        rule: highFixed,
      }),
    );
    const period = periodOf('monthly', '2026-11-10');
    const chart = round2(
      dailySeries(entries, period.start, period.end).reduce(
        (sum, point) => sum + point.earnings,
        0,
      ),
    );
    const totals = sumEntriesCapped(entries);
    expect(chart).toBe(10000);
    expect(totals.total).toBe(10000);
    expect(Math.abs(chart - totals.total)).toBeLessThan(0.001);

    const prorated = { ...highFixed, monthlyMode: 'prorated' as const };
    const proratedEntries = entries.map((entry) => ({ ...entry, rule: prorated }));
    const proratedChart = round2(
      dailySeries(proratedEntries, period.start, period.end).reduce(
        (sum, point) => sum + point.earnings,
        0,
      ),
    );
    expect(proratedChart).toBe(sumEntriesCapped(proratedEntries).total);
  });
});
