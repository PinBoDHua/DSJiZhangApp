import { describe, expect, it } from 'vitest';
import { buildHeatmap, heatmapAriaLabel, percentChange } from './insights';
import { makeEntry, makeJob, makeState } from './testFixtures';

describe('工时热力图', () => {
  it('生成 12 周 × 7 天，并按工时深浅分级', () => {
    const state = makeState({
      jobs: [makeJob()],
      entries: [
        makeEntry({ id: 'a', date: '2026-08-17', hours: 12 }),
        makeEntry({ id: 'b', date: '2026-11-02', hours: 8, createdAt: '2026-11-02T12:00:00.000Z' }),
        makeEntry({ id: 'c', date: '2026-11-03', hours: 4, createdAt: '2026-11-03T12:00:00.000Z' }),
      ],
    });
    const heatmap = buildHeatmap(state.entries, { today: '2026-11-05', weekStartsOn: 1 });
    expect(heatmap.weeks).toHaveLength(12);
    expect(heatmap.weeks.flatMap((week) => week.days)).toHaveLength(84);
    expect(heatmap.totalHours).toBe(24);
    const days = heatmap.weeks.flatMap((week) => week.days);
    expect(days.find((day) => day.date === '2026-08-17')?.level).toBe(4);
    expect(days.find((day) => day.date === '2026-11-02')?.level).toBe(3);
    expect(days.find((day) => day.date === '2026-11-03')?.level).toBe(2);
    expect(days.find((day) => day.date === '2026-11-06')?.isFuture).toBe(true);
    expect(days.find((day) => day.date === '2026-11-05')?.isToday).toBe(true);
  });

  it('同岗位同日多段日薪只计一次基础工资', () => {
    const rule = { ...makeJob().rule, payType: 'daily' as const, rate: 300, otEnabled: false };
    const heatmap = buildHeatmap(
      [
        makeEntry({ id: 'daily-a', hours: 4, rule }),
        makeEntry({ id: 'daily-b', hours: 3, rule }),
      ],
      { today: '2026-11-05', weekStartsOn: 1 },
    );
    expect(heatmap.totalEarnings).toBe(300);
    expect(heatmap.totalHours).toBe(7);
  });

  it('空账本返回全 0，且不产生 NaN', () => {
    const heatmap = buildHeatmap([], { today: '2026-11-05' });
    expect(heatmap.totalHours).toBe(0);
    expect(heatmap.maxHours).toBe(0);
    expect(heatmap.weeks.flatMap((week) => week.days).every((day) => day.level === 0)).toBe(true);
  });

  it('周一 / 周日起始都能对齐', () => {
    const monday = buildHeatmap([], { today: '2026-11-05', weekStartsOn: 1 });
    const sunday = buildHeatmap([], { today: '2026-11-05', weekStartsOn: 0 });
    expect(monday.weeks[11].days[0].date).toBe('2026-11-02');
    expect(sunday.weeks[11].days[0].date).toBe('2026-11-01');
  });

  it('提供可读的无障碍描述', () => {
    const heatmap = buildHeatmap([], { today: '2026-11-05' });
    expect(heatmapAriaLabel(heatmap)).toContain('最近 12 周');
  });

  it('百分比对比在基数为 0 时返回 null', () => {
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(12, 10)).toBe(20);
  });
});
