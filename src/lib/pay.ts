import type { Entry, EntryPay, PayRule } from '../types';
import { isWeekend } from './date';
import { clamp, round2 } from './money';

export function otMultiplierFor(date: string, holiday: boolean, rule: PayRule): number {
  if (holiday) return rule.holidayOT || 3;
  if (isWeekend(date)) return rule.weekendOT || 2;
  return rule.weekdayOT || 1.5;
}

/** 每小时加班费的计算基数 */
export function otHourlyRate(rule: PayRule): number {
  const standard = rule.standardHours > 0 ? rule.standardHours : 8;
  if (rule.payType === 'hourly') return rule.rate;
  if (rule.payType === 'daily') return rule.rate / standard;
  if (rule.payType === 'piece') return 0;
  const expectedDays = rule.expectedDays > 0 ? rule.expectedDays : 22;
  return rule.rate / expectedDays / standard;
}

/** 时薪模式下，超出标准工时的部分自动计为加班 */
export function autoOtHours(hours: number, rule: PayRule): number {
  if (!rule.otEnabled || rule.payType === 'piece') return 0;
  const standard = rule.standardHours > 0 ? rule.standardHours : 8;
  return round2(Math.max(0, hours - standard));
}

export function payForEntry(entry: Entry): EntryPay {
  const rule = entry.rule;
  const rate = Math.max(0, rule.rate || 0);
  const standard = rule.standardHours > 0 ? rule.standardHours : 8;
  const expectedDays = rule.expectedDays > 0 ? rule.expectedDays : 22;
  const hours = Math.max(0, entry.hours || 0);
  const quantity = Math.max(0, entry.quantity || 0);
  const bonus = round2(Math.max(0, entry.bonus || 0));
  const deduction = round2(Math.max(0, entry.deduction || 0));
  const isPiece = rule.payType === 'piece';

  let otHours = rule.otEnabled && !isPiece ? Math.max(0, entry.otHours || 0) : 0;
  otHours = round2(clamp(otHours, 0, hours));

  let base = 0;
  if (rule.payType === 'hourly') {
    base = Math.max(0, hours - otHours) * rate;
  } else if (rule.payType === 'daily') {
    base = rate;
  } else if (rule.payType === 'monthly') {
    base = rate / expectedDays;
  } else {
    base = quantity * rate;
  }

  const multiplier = isPiece
    ? 1
    : rule.otEnabled
      ? otMultiplierFor(entry.date, entry.holiday, rule)
      : 1;
  const otRate = otHourlyRate(rule);
  const otPay = otHours > 0 ? otHours * otRate * multiplier : 0;
  const roundedBase = round2(base);
  const roundedOtPay = round2(otPay);

  return {
    base: roundedBase,
    otPay: roundedOtPay,
    otHours,
    otRate: round2(otRate),
    multiplier,
    bonus,
    deduction,
    total: round2(roundedBase + roundedOtPay + bonus - deduction),
  };
}

export function payTypeName(rule: PayRule): string {
  if (rule.payType === 'hourly') return '时薪';
  if (rule.payType === 'daily') return '日薪';
  if (rule.payType === 'monthly') return '月薪';
  return '计件';
}
