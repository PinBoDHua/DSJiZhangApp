import { describe, expect, it } from 'vitest';
import type { Settlement } from '../types';
import {
  legacySettlementChecksum,
  settlementChecksum,
  verifySettlementChecksum,
} from './checksum';

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
  it('新版 sha256 短码带算法前缀，结果稳定且与独立实现一致', () => {
    const code = settlementChecksum(settlement);
    expect(code).toBe('sha256:24bd8bf73414f1db');
    expect(settlementChecksum({ ...settlement })).toBe(code);
  });

  it('改分项但 net 不变时校验码也会变化', () => {
    const code = settlementChecksum(settlement);
    // base 减 0.01、bonus 加 0.01：分项变了、net 不变。
    expect(settlementChecksum({ ...settlement, base: 3499.99, bonus: 0.01 })).not.toBe(code);
    // 额外奖扣一增一减：net 同样不变。
    expect(
      settlementChecksum({ ...settlement, extraBonus: 1, extraDeduction: 1 }),
    ).not.toBe(code);
    // 收款字段不在 net 内，也必须被覆盖。
    expect(settlementChecksum({ ...settlement, paidAmount: 0.01 })).not.toBe(code);
    expect(settlementChecksum({ ...settlement, paymentStatus: 'partial' })).not.toBe(code);
    expect(settlementChecksum({ ...settlement, hours: 12.5 })).not.toBe(code);
    expect(settlementChecksum({ ...settlement, overRestDeduction: 0.01 })).not.toBe(code);
  });

  it('旧版无前缀校验码继续按旧算法兼容验证', () => {
    const legacy = legacySettlementChecksum(settlement);
    expect(legacy).toBe('C1A8-CD7B');
    expect(legacy).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(verifySettlementChecksum(settlement, legacy)).toBe(true);
    expect(verifySettlementChecksum(settlement, settlementChecksum(settlement))).toBe(true);
    expect(verifySettlementChecksum(settlement, '')).toBe(false);
    expect(verifySettlementChecksum({ ...settlement, net: 3500.01 }, legacy)).toBe(false);
    // 旧算法只覆盖净额：分项被改也能通过（历史结算单兼容，新码已覆盖全部分项）。
    expect(verifySettlementChecksum({ ...settlement, bonus: 99 }, legacy)).toBe(true);
  });
});
