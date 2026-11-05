import { describe, expect, it } from 'vitest';
import type { Settlement } from '../types';
import { buildPayslipRows } from './payslip';
import { DEFAULT_PAYSLIP_OPTIONS, normalizePayslipOptions } from './payslipOptions';

const settlement = {
  id: 'settlement-1',
  jobId: 'job-1',
  jobName: '老宅装修',
  cycle: 'monthly',
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  payType: 'monthly',
  monthlyMode: 'fixed',
  base: 3500,
  otPay: 120,
  bonus: 50,
  deduction: 20,
  overRestDays: 1,
  overRestDeduction: 159.09,
  advanceTotal: 500,
  extraBonus: 30,
  extraDeduction: 10,
  net: 3010.91,
  hours: 12,
  days: 2,
  otHours: 2,
  entryIds: [],
  advanceIds: [],
  createdAt: '2026-11-30T12:00:00.000Z',
} as Settlement;

describe('工资条明细行', () => {
  it('默认显示全部有金额的明细行', () => {
    const rows = buildPayslipRows(settlement);
    expect(rows.map((row) => row.label)).toEqual([
      '固定月薪',
      '加班工资',
      '奖金补贴',
      '扣款',
      '超休扣款',
      '借支抵扣',
    ]);
    expect(rows.find((row) => row.label === '奖金补贴')?.value).toBe(80);
    expect(rows.find((row) => row.label === '扣款')?.value).toBe(30);
  });

  it('可以隐藏指定明细行，不影响结算金额', () => {
    const rows = buildPayslipRows(settlement, {
      ...DEFAULT_PAYSLIP_OPTIONS,
      showOvertime: false,
      showBonus: false,
      showAdvance: false,
    });
    expect(rows.map((row) => row.label)).toEqual([
      '固定月薪',
      '扣款',
      '超休扣款',
    ]);
  });

  it('读取旧偏好时补默认值并截断页脚', () => {
    const options = normalizePayslipOptions({
      showBonus: false,
      footerNote: '一'.repeat(40),
    });
    expect(options.showBonus).toBe(false);
    expect(options.showOvertime).toBe(true);
    expect(options.footerNote).toHaveLength(30);
  });
});
