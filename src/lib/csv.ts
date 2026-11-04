import type { Settlement } from '../types';
import { PAYMENT_STATUS_LABEL, paidAmountOf, paymentStatusOf, remainingAmountOf } from './payment';

function cell(value: string | number): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

export function buildSettlementCsv(settlements: Settlement[]): string {
  const rows: Array<Array<string | number>> = [
    [
      '工作',
      '周期开始',
      '周期结束',
      '结算周期',
      '出勤天数',
      '休息天数',
      '工时',
      '基础工资',
      '加班工资',
      '奖金',
      '扣款',
      '超休扣款',
      '借支抵扣',
      '应发净额',
      '已收',
      '待收',
      '收款状态',
      '收款日期',
      '收款方式',
      '收款备注',
    ],
  ];
  for (const settlement of settlements) {
    rows.push([
      settlement.jobName,
      settlement.periodStart,
      settlement.periodEnd,
      settlement.cycle,
      settlement.days,
      settlement.restDays ?? 0,
      settlement.hours,
      settlement.base,
      settlement.otPay,
      settlement.bonus + settlement.extraBonus,
      settlement.deduction + settlement.extraDeduction,
      settlement.overRestDeduction ?? 0,
      settlement.advanceTotal,
      settlement.net,
      paidAmountOf(settlement),
      remainingAmountOf(settlement),
      PAYMENT_STATUS_LABEL[paymentStatusOf(settlement)],
      settlement.paidAt ?? '',
      settlement.paymentMethod ?? '',
      settlement.paymentNote ?? '',
    ]);
  }
  return `\uFEFF${buildCsv(rows)}`;
}
