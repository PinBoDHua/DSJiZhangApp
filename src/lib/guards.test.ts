import { describe, expect, it } from 'vitest';
import {
  dayHours,
  findRestOnDay,
  findSettlementOverlap,
  wouldExceedDayLimit,
} from './guards';
import { makeEntry, makeRestDay, makeSettlement } from './testFixtures';

describe('同一天 24 小时守卫', () => {
  const entries = [
    makeEntry({ id: 'a', date: '2026-11-02', hours: 10 }),
    makeEntry({ id: 'b', date: '2026-11-02', jobId: 'job-2', hours: 8 }),
    makeEntry({ id: 'c', date: '2026-11-03', hours: 5 }),
  ];

  it('汇总当天所有岗位的工时', () => {
    expect(dayHours(entries, '2026-11-02')).toBe(18);
    expect(dayHours(entries, '2026-11-03')).toBe(5);
    expect(dayHours(entries, '2026-11-04')).toBe(0);
  });

  it('新增后超过 24 小时拦截，刚好 24 小时放行', () => {
    expect(wouldExceedDayLimit(entries, '2026-11-02', 7)).toBe(true);
    expect(wouldExceedDayLimit(entries, '2026-11-02', 6)).toBe(false);
  });

  it('编辑时排除自身记录', () => {
    expect(wouldExceedDayLimit(entries, '2026-11-02', 16, 'a')).toBe(false);
    expect(wouldExceedDayLimit(entries, '2026-11-02', 17, 'a')).toBe(true);
  });

  it('0 工时（计件 / 只记出勤）不参与上限', () => {
    expect(wouldExceedDayLimit(entries, '2026-11-02', 0)).toBe(false);
  });
});

describe('同日休息冲突', () => {
  it('按岗位 + 日期查找休息', () => {
    const rests = [makeRestDay({ id: 'rest-1', jobId: 'job-1', date: '2026-11-02' })];
    expect(findRestOnDay(rests, 'job-1', '2026-11-02')?.id).toBe('rest-1');
    expect(findRestOnDay(rests, 'job-2', '2026-11-02')).toBeUndefined();
  });
});

describe('结算周期重叠', () => {
  const settlements = [
    makeSettlement({ id: 's1', jobId: 'job-1', periodStart: '2026-11-02', periodEnd: '2026-11-08' }),
  ];

  it('同周期 / 包含 / 部分重叠都拦截', () => {
    expect(
      findSettlementOverlap(settlements, 'job-1', {
        start: '2026-11-05',
        end: '2026-11-11',
      })?.id,
    ).toBe('s1');
    expect(
      findSettlementOverlap(settlements, 'job-1', {
        start: '2026-11-01',
        end: '2026-11-03',
      })?.id,
    ).toBe('s1');
  });

  it('首尾相接和不同工作不算重叠', () => {
    expect(
      findSettlementOverlap(settlements, 'job-1', {
        start: '2026-11-09',
        end: '2026-11-15',
      }),
    ).toBeUndefined();
    expect(
      findSettlementOverlap(settlements, 'job-2', {
        start: '2026-11-02',
        end: '2026-11-08',
      }),
    ).toBeUndefined();
  });
});
