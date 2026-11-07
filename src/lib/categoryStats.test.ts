import { describe, expect, it } from 'vitest';
import { payTypeBreakdown } from './categoryStats';
import { baseRule, makeEntry } from './testFixtures';
import { sumEntriesCapped } from './settlement';

describe('计薪类型分类统计', () => {
  it('固定月薪与自然月合计一致，同日多段不重复计基础工资', () => {
    const rule = { ...baseRule, payType: 'monthly' as const, rate: 3500, monthlyMode: 'fixed' as const, otEnabled: false };
    const entries = [
      makeEntry({ id: 'm1', date: '2026-11-02', rule }),
      makeEntry({ id: 'm2', date: '2026-11-03', rule }),
      makeEntry({ id: 'm3', date: '2026-11-03', rule }),
    ];
    const rows = payTypeBreakdown(entries, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: '月薪', total: 3500, days: 2, count: 3 });
    expect(rows[0].total).toBe(sumEntriesCapped(entries).total);
  });

  it('跨月固定月薪分别封顶，并与其他类型共同汇总', () => {
    const monthly = { ...baseRule, payType: 'monthly' as const, rate: 3500, monthlyMode: 'fixed' as const, otEnabled: false };
    const entries = [
      makeEntry({ id: 'm10', date: '2026-10-15', rule: monthly }),
      makeEntry({ id: 'm11', date: '2026-11-15', rule: monthly }),
      makeEntry({ id: 'h1', date: '2026-11-16', hours: 8, otHours: 0, rule: { ...baseRule, otEnabled: false } }),
    ];
    const rows = payTypeBreakdown(entries, true);
    expect(rows.find((row) => row.payType === 'monthly')?.total).toBe(7000);
    expect(rows.find((row) => row.payType === 'hourly')?.total).toBe(200);
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(sumEntriesCapped(entries).total);
  });
});
