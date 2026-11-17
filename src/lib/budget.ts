import type { BudgetSettings, Entry } from '../types';
import { monthKey, todayISO } from './date';
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
  // 函数内部按月界过滤：即使调用方传入全量工记，也只统计 today 所在月且不含未来。
  const month = monthKey(today);
  const totals = sumEntriesCapped(
    entries.filter((entry) => entry.date <= today && monthKey(entry.date) === month),
  );
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
/** 存储不可用时的兜底节流：同键 30 分钟内只提醒一次，避免每次渲染刷屏。 */
const ALERT_FALLBACK_THROTTLE_MS = 30 * 60 * 1000;
const fallbackAlertAt = new Map<string, number>();

/** 读取已提醒键；兼容旧版本直接存单个字符串的格式。 */
function parseBudgetAlertKeys(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // 旧版本存的是单键字符串。
  }
  return [raw];
}

/**
 * 同月、同一档位、同配置只提醒一次；页面里的预算横幅仍会持续显示。
 * 键按「档位」区分（靠近目标 / 达成 / 工时接近 / 超工时各提醒一次），不再互相覆盖。
 * 存储不可用（隐私模式 / 配额满）时退化为内存键 + 30 分钟节流。
 */
export function shouldToastBudgetAlert(
  month: string,
  status: MonthlyBudgetStatus | null,
): boolean {
  const alert = status?.alert;
  if (!status || !alert) return false;
  const key = `${month}:${alert.code}:${status.incomeTarget}:${status.hoursLimit}`;
  try {
    const fired = parseBudgetAlertKeys(localStorage.getItem(BUDGET_ALERT_KEY));
    if (fired.includes(key)) return false;
    // 只保留最近 20 个键，避免本地存储无限增长。
    localStorage.setItem(BUDGET_ALERT_KEY, JSON.stringify([...fired, key].slice(-20)));
    return true;
  } catch {
    const now = Date.now();
    const last = fallbackAlertAt.get(key);
    if (last !== undefined && now - last < ALERT_FALLBACK_THROTTLE_MS) return false;
    if (fallbackAlertAt.size > 50) fallbackAlertAt.clear();
    fallbackAlertAt.set(key, now);
    return true;
  }
}

