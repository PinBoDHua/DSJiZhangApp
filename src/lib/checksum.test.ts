import { describe, expect, it } from 'vitest';
import type { Settlement } from '../types';
import { settlementChecksum } from './checksum';

const settlement = {
  id: 'settlement-1',
  jobId: 'job-1',
  jobName: '老宅装修',
  cycle: 'monthly',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  base: 3500,
  otPay: 0,
  bonus: 0,
  deduction: 0,
  advanceTotal: 0,
  extraBonus: 0,
  extraDeduction: 0,
  net: 3500,
  hours: 12,
  days: 2,
  otHours: 0,
  entryIds: [],
  advanceIds: [],
  createdAt: '2026-11-30T12:00:00.000Z',
} as Settlement;

describe('结算校验码', () => {
  it('同一张结算单稳定生成 8 位校验码', () => {
    const code = settlementChecksum(settlement);
    expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(settlementChecksum({ ...settlement })).toBe(code);
  });

  it('金额变化后校验码变化', () => {
    expect(settlementChecksum({ ...settlement, net: 3500.01 })).not.toBe(
      settlementChecksum(settlement),
    );
  });
});
