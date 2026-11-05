import { describe, expect, it } from 'vitest';
import type { RestDay } from '../types';
import { formatRestDays, restDayAmount, totalRestDays } from './rest';

function rest(days?: number): RestDay {
  return {
    id: `rest-${days ?? 'default'}`,
    jobId: 'job-1',
    date: '2026-11-03',
    days,
    createdAt: '2026-11-03T12:00:00.000Z',
  };
}

describe('休息天数', () => {
  it('缺省按整天，0.5 按半天', () => {
    expect(restDayAmount(rest())).toBe(1);
    expect(restDayAmount(rest(1))).toBe(1);
    expect(restDayAmount(rest(0.5))).toBe(0.5);
    expect(restDayAmount(rest(0.25))).toBe(1);
  });

  it('合计和展示保留一位小数', () => {
    expect(totalRestDays([rest(), rest(0.5), rest(0.5)])).toBe(2);
    expect(totalRestDays([rest(), rest(0.5)])).toBe(1.5);
    expect(formatRestDays(2)).toBe('2');
    expect(formatRestDays(1.5)).toBe('1.5');
    expect(formatRestDays(0.5)).toBe('0.5');
  });
});
