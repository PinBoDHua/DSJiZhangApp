import type { PaymentStatus, Settlement } from '../types';
import { addMonths, daysInMonth } from './date';

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: '待发',
  partial: '部分发放',
  paid: '已发',
};

export function paymentStatusOf(settlement: Settlement): PaymentStatus {
  if (settlement.paymentStatus) return settlement.paymentStatus;
  const paid = settlement.paidAmount ?? 0;
  if (paid <= 0) return 'unpaid';
  if (paid >= settlement.net) return 'paid';
  return 'partial';
}

export function paidAmountOf(settlement: Settlement): number {
  return Math.max(0, Math.min(settlement.net, settlement.paidAmount ?? 0));
}

export function remainingAmountOf(settlement: Settlement): number {
  return Math.max(0, Math.round((settlement.net - paidAmountOf(settlement)) * 100) / 100);
}

/** 距离下一次发薪日还有几天；今天就是发薪日时返回 0。 */
export function daysUntilPayday(payday: number, today: string): number {
  const currentDay = Number(today.slice(8));
  const safePayday = Math.max(1, Math.min(31, Math.round(payday)));
  const thisMonthDay = Math.min(safePayday, daysInMonth(today));
  if (thisMonthDay >= currentDay) return thisMonthDay - currentDay;
  const nextMonth = addMonths(today, 1);
  return daysInMonth(today) - currentDay + Math.min(safePayday, daysInMonth(nextMonth));
}
