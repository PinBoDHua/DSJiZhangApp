import type { BudgetSettings, Entry } from '../types';
import { todayISO } from './date';
import { round2 } from './money';
import { sumEntriesCapped } from './settlement';

export type BudgetAlertTone = 'info' | 'success' | 'warning';

export interface BudgetAlert {
  code: 'income-near' | 'income-reached' | 'hours-near' | 'hours-exceeded';
  message: string;
  tone: BudgetAlertTone;
}

export interface MonthlyBudgetStatus {
  income: number;
  hours: number;
  incomeTarget: number;
  hoursLimit: number;
  incomePercent: number;
  hoursPercent: number;
  alert: BudgetAlert | null;
}

export function monthlyBudgetStatus(
  settings: BudgetSettings | undefined,
  entries: Entry[],
  today = todayISO(),
): MonthlyBudgetStatus | null {
  if (!settings?.enabled) return null;
  const incomeTarget = Math.max(0, settings.incomeTarget || 0);
  const hoursLimit = Math.max(0, settings.hoursLimit || 0);
  if (incomeTarget <= 0 && hoursLimit <= 0) return null;
  const totals = sumEntriesCapped(entries.filter((entry) => entry.date <= today));
  const incomePercent = incomeTarget > 0 ? (totals.total / incomeTarget) * 100 : 0;
  const hoursPercent = hoursLimit > 0 ? (totals.hours / hoursLimit) * 100 : 0;
  let alert: BudgetAlert | null = null;
  if (hoursLimit > 0 && totals.hours >= hoursLimit) {
    alert = {
      code: 'hours-exceeded',
      message: `本月工时已达 ${round2(totals.hours)}h，达到你设的 ${round2(hoursLimit)}h 上限`,
      tone: 'warning',
    };
  } else if (incomeTarget > 0 && totals.total >= incomeTarget) {
    alert = {
      code: 'income-reached',
      message: `本月收入目标已达成，当前已计入 ${Math.floor(incomePercent)}%`,
      tone: 'success',
    };
  } else if (hoursLimit > 0 && totals.hours >= hoursLimit * 0.8) {
    alert = {
      code: 'hours-near',
      message: `本月工时已到上限的 ${Math.floor(hoursPercent)}%，注意安排休息`,
      tone: 'warning',
    };
  } else if (incomeTarget > 0 && totals.total >= incomeTarget * 0.8) {
    alert = {
      code: 'income-near',
      message: `本月收入已计入 ${Math.floor(incomePercent)}%，接近目标了`,
      tone: 'info',
    };
  }
  return {
    income: totals.total,
    hours: totals.hours,
    incomeTarget,
    hoursLimit,
    incomePercent,
    hoursPercent,
    alert,
  };
}

const BUDGET_ALERT_KEY = 'xinshi.budgetAlert';

/** 同月同档位、同配置只提醒一次；页面中的预算横幅仍会持续显示。 */
export function shouldToastBudgetAlert(
  month: string,
  status: MonthlyBudgetStatus | null,
): boolean {
  const alert = status?.alert;
  if (!status || !alert) return false;
  const key = `${month}:${alert.code}:${status.incomeTarget}:${status.hoursLimit}`;
  try {
    if (localStorage.getItem(BUDGET_ALERT_KEY) === key) return false;
    localStorage.setItem(BUDGET_ALERT_KEY, key);
  } catch {
    // 存储不可用时仍允许本次提醒。
  }
  return true;
}
