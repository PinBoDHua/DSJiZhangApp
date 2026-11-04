import type {
  Advance,
  AppState,
  Entry,
  Job,
  Period,
  RestDay,
  Settlement,
  SettlementDraft,
  Totals,
} from '../types';
import {
  eachDay,
  formatDateWithWeekday,
  monthKey,
  periodContains,
  periodOf,
  todayISO,
} from './date';
import { formatMoney, round2 } from './money';
import { payForEntry } from './pay';
import {
  PAYMENT_STATUS_LABEL,
  paidAmountOf,
  paymentStatusOf,
  remainingAmountOf,
} from './payment';

const EMPTY_TOTALS: Totals = {
  base: 0,
  otPay: 0,
  bonus: 0,
  deduction: 0,
  total: 0,
  hours: 0,
  days: 0,
  otHours: 0,
  capAdjustment: 0,
};

/** 逐笔汇总（月薪按每日折算展示，不封顶） */
export function sumEntries(entries: Entry[]): Totals {
  const days = new Set<string>();
  let base = 0;
  let otPay = 0;
  let bonus = 0;
  let deduction = 0;
  let hours = 0;
  let otHours = 0;

  for (const entry of entries) {
    const pay = payForEntry(entry);
    base += pay.base;
    otPay += pay.otPay;
    bonus += pay.bonus;
    deduction += pay.deduction;
    hours += entry.hours || 0;
    otHours += pay.otHours;
    days.add(entry.date);
  }

  const roundedBase = round2(base);
  const roundedOt = round2(otPay);
  const roundedBonus = round2(bonus);
  const roundedDeduction = round2(deduction);
  return {
    base: roundedBase,
    otPay: roundedOt,
    bonus: roundedBonus,
    deduction: roundedDeduction,
    total: round2(roundedBase + roundedOt + roundedBonus - roundedDeduction),
    hours: round2(hours),
    days: days.size,
    otHours: round2(otHours),
    capAdjustment: 0,
  };
}

/**
 * 汇总并按「月薪整月封顶」校正。
 * 月薪工作按 (月薪 / 计薪天数 × 当月出勤天数) 计算基础工资，超过整月月薪时封顶。
 */
export function sumEntriesCapped(entries: Entry[]): Totals {
  const monthlyGroups = new Map<string, Entry[]>();
  const regular: Entry[] = [];

  for (const entry of entries) {
    if (entry.rule.payType === 'monthly') {
      const key = `${entry.jobId}|${monthKey(entry.date)}`;
      const group = monthlyGroups.get(key);
      if (group) group.push(entry);
      else monthlyGroups.set(key, [entry]);
    } else {
      regular.push(entry);
    }
  }

  const totals: Totals = { ...EMPTY_TOTALS };
  const allDays = new Set<string>();

  const consume = (entry: Entry, includeBase = true) => {
    const pay = payForEntry(entry);
    if (includeBase) totals.base += pay.base;
    totals.otPay += pay.otPay;
    totals.bonus += pay.bonus;
    totals.deduction += pay.deduction;
    totals.hours += entry.hours || 0;
    totals.otHours += pay.otHours;
    allDays.add(entry.date);
  };

  for (const entry of regular) consume(entry);

  for (const group of monthlyGroups.values()) {
    const latest = group.reduce(
      (best, item) => (item.createdAt >= best.createdAt ? item : best),
      group[0],
    );
    const days = new Set(group.map((entry) => entry.date)).size;
    const expectedDays = latest.rule.expectedDays > 0 ? latest.rule.expectedDays : 22;
    const rate = Math.max(0, latest.rule.rate);
    const rawBase = (rate / expectedDays) * days;
    const fixed = latest.rule.monthlyMode === 'fixed';
    const paidBase = fixed ? rate : Math.min(rawBase, rate);
    totals.base += round2(paidBase);
    totals.capAdjustment += fixed ? 0 : Math.max(0, rawBase - rate);
    for (const entry of group) consume(entry, false);
  }

  totals.base = round2(totals.base);
  totals.otPay = round2(totals.otPay);
  totals.bonus = round2(totals.bonus);
  totals.deduction = round2(totals.deduction);
  totals.hours = round2(totals.hours);
  totals.otHours = round2(totals.otHours);
  totals.days = allDays.size;
  totals.capAdjustment = round2(totals.capAdjustment);
  totals.total = round2(totals.base + totals.otPay + totals.bonus - totals.deduction);
  return totals;
}

export function totalAdvanceAmount(advances: Advance[]): number {
  return round2(advances.reduce((sum, item) => sum + (item.amount || 0), 0));
}

/** 全部未结工钱：未结算记录 + 未抵扣借支 */
export function computeOutstanding(state: AppState): {
  totals: Totals;
  advanceTotal: number;
  net: number;
  count: number;
} {
  const entries = state.entries.filter((entry) => !entry.settlementId);
  const totals = sumEntriesCapped(entries);
  const advances = state.advances.filter((advance) => !advance.settlementId);
  const advanceTotal = totalAdvanceAmount(advances);
  return {
    totals,
    advanceTotal,
    net: round2(totals.total - advanceTotal),
    count: entries.length,
  };
}

export function buildSettlementDraft(
  job: Job,
  entries: Entry[],
  advances: Advance[],
  period: Period,
  extraBonus = 0,
  extraDeduction = 0,
  restDays: RestDay[] = [],
  overRestEnabled = true,
  overRestAmount?: number,
): SettlementDraft {
  const jobEntries = entries
    .filter(
      (entry) =>
        entry.jobId === job.id && !entry.settlementId && periodContains(period, entry.date),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

  const includedAdvances = advances
    .filter(
      (advance) =>
        advance.jobId === job.id &&
        !advance.settlementId &&
        advance.date <= period.end,
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const totals = sumEntriesCapped(jobEntries);
  const advanceTotal = totalAdvanceAmount(includedAdvances);
  const safeBonus = round2(Math.max(0, extraBonus));
  const safeDeduction = round2(Math.max(0, extraDeduction));
  const latestEntry = jobEntries[jobEntries.length - 1];
  const payType = latestEntry?.rule.payType ?? job.rule.payType;
  const monthlyMode = latestEntry?.rule.monthlyMode ?? job.rule.monthlyMode;
  const unitLabel = latestEntry?.rule.unitLabel ?? job.rule.unitLabel ?? '件';
  const quantity = round2(
    jobEntries.reduce((sum, entry) => sum + (entry.quantity || 0), 0),
  );
  const restCount = restDays.filter(
    (rest) => rest.jobId === job.id && periodContains(period, rest.date),
  ).length;
  const isFixedMonthly = payType === 'monthly' && monthlyMode === 'fixed';
  const policy = job.rule;
  const overRestDays = isFixedMonthly
    ? Math.max(0, restCount - Math.max(0, policy.restDaysPerMonth))
    : 0;
  const dailyRate =
    policy.overRestDailyRate > 0
      ? policy.overRestDailyRate
      : policy.rate / Math.max(1, policy.expectedDays);
  const autoOverRestDeduction = round2(overRestDays * dailyRate);
  const overRestDeduction =
    isFixedMonthly && policy.overRestDeduct && overRestEnabled
      ? round2(
          Math.min(
            Math.max(0, totals.base),
            Math.max(
              0,
              overRestAmount === undefined ? autoOverRestDeduction : overRestAmount,
            ),
          ),
        )
      : 0;
  const net = round2(
    totals.total + safeBonus - safeDeduction - advanceTotal - overRestDeduction,
  );

  return {
    jobId: job.id,
    jobName: job.name,
    cycle: job.cycle,
    payType,
    monthlyMode,
    quantity,
    unitLabel,
    restDays: restCount,
    period,
    entries: jobEntries,
    advances: includedAdvances,
    base: totals.base,
    otPay: totals.otPay,
    bonus: totals.bonus,
    deduction: totals.deduction,
    extraBonus: safeBonus,
    extraDeduction: safeDeduction,
    overRestDays,
    overRestDeduction,
    advanceTotal,
    net,
    hours: totals.hours,
    days: totals.days,
    otHours: totals.otHours,
    capAdjustment: totals.capAdjustment,
    entryIds: jobEntries.map((entry) => entry.id),
    advanceIds: includedAdvances.map((advance) => advance.id),
  };
}

export interface JobSettlementOverview {
  job: Job;
  period: Period;
  draft: SettlementDraft;
  entryCount: number;
  otherPeriods: number;
  advanceTotal: number;
  outstanding: number;
}

export interface SettlementOverview {
  jobs: JobSettlementOverview[];
  totals: Totals;
  advanceTotal: number;
  outstanding: number;
}

/** 结算页数据：每份工作从「最早未结周期」开始，逐期结清 */
export function getSettlementOverview(state: AppState): SettlementOverview {
  const outstanding = computeOutstanding(state);
  const jobs: JobSettlementOverview[] = [];

  for (const job of state.jobs) {
    const jobEntries = state.entries.filter(
      (entry) => entry.jobId === job.id && !entry.settlementId,
    );
    const jobAdvances = state.advances.filter(
      (advance) => advance.jobId === job.id && !advance.settlementId,
    );
    if (jobEntries.length === 0 && jobAdvances.length === 0) continue;

    const dates = jobEntries.map((entry) => entry.date).sort();
    const anchor = dates[0] ?? todayISO();
    const period = periodOf(job.cycle, anchor, state.settings.weekStartsOn);
    const draft = buildSettlementDraft(job, state.entries, state.advances, period);
    const other = new Set(
      jobEntries
        .filter((entry) => !periodContains(period, entry.date))
        .map((entry) => periodOf(job.cycle, entry.date, state.settings.weekStartsOn).key),
    );
    const total = sumEntriesCapped(jobEntries).total;
    const advanceTotal = totalAdvanceAmount(jobAdvances);

    jobs.push({
      job,
      period,
      draft,
      entryCount: jobEntries.length,
      otherPeriods: other.size,
      advanceTotal,
      outstanding: round2(total - advanceTotal),
    });
  }

  jobs.sort((a, b) => a.period.start.localeCompare(b.period.start) || a.job.name.localeCompare(b.job.name));

  return {
    jobs,
    totals: outstanding.totals,
    advanceTotal: outstanding.advanceTotal,
    outstanding: outstanding.net,
  };
}

export function currentPeriodForJob(job: Job, weekStartsOn: 0 | 1): Period {
  return periodOf(job.cycle, todayISO(), weekStartsOn);
}

export function makeSettlement(
  draft: SettlementDraft,
  id: string,
  createdAt: string,
  note?: string,
): Settlement {
  return {
    id,
    jobId: draft.jobId,
    jobName: draft.jobName,
    cycle: draft.cycle,
    periodStart: draft.period.start,
    periodEnd: draft.period.end,
    payType: draft.payType,
    monthlyMode: draft.monthlyMode,
    quantity: draft.quantity,
    unitLabel: draft.unitLabel,
    restDays: draft.restDays,
    base: draft.base,
    otPay: draft.otPay,
    bonus: draft.bonus,
    deduction: draft.deduction,
    overRestDays: draft.overRestDays,
    overRestDeduction: draft.overRestDeduction,
    advanceTotal: draft.advanceTotal,
    extraBonus: draft.extraBonus,
    extraDeduction: draft.extraDeduction,
    net: draft.net,
    hours: draft.hours,
    days: draft.days,
    otHours: draft.otHours,
    entryIds: draft.entryIds,
    advanceIds: draft.advanceIds,
    note,
    createdAt,
    paymentStatus: 'unpaid',
    paidAmount: 0,
  };
}

export interface DailyPoint {
  date: string;
  earnings: number;
  hours: number;
}

export function dailySeries(entries: Entry[], start: string, end: string): DailyPoint[] {
  const map = new Map<string, DailyPoint>();
  for (const day of eachDay(start, end)) {
    map.set(day, { date: day, earnings: 0, hours: 0 });
  }
  for (const entry of entries) {
    const point = map.get(entry.date);
    if (!point) continue;
    const pay = payForEntry(entry);
    point.earnings = round2(point.earnings + pay.total);
    point.hours = round2(point.hours + (entry.hours || 0));
  }
  return Array.from(map.values());
}

export function entriesInPeriod(entries: Entry[], period: Period): Entry[] {
  return entries.filter((entry) => periodContains(period, entry.date));
}

export function jobBreakdown(
  entries: Entry[],
  capMonthly: boolean,
): Array<{ jobId: string; total: number; hours: number; days: number }> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.jobId);
    if (group) group.push(entry);
    else groups.set(entry.jobId, [entry]);
  }
  return Array.from(groups.entries())
    .map(([jobId, group]) => {
      const totals = capMonthly ? sumEntriesCapped(group) : sumEntries(group);
      return { jobId, total: totals.total, hours: totals.hours, days: totals.days };
    })
    .sort((a, b) => b.total - a.total);
}

export function settlementPeriodLabel(settlement: Settlement): string {
  return `${formatDateWithWeekday(settlement.periodStart)} – ${formatDateWithWeekday(
    settlement.periodEnd,
  )}`;
}

export function settlementCopyText(settlement: Settlement): string {
  const start = settlement.periodStart.replace(/-/g, '.');
  const end = settlement.periodEnd.replace(/-/g, '.');
  const isFixedMonthly =
    settlement.payType === 'monthly' && settlement.monthlyMode === 'fixed';
  const lines = [
    '【薪时 · 结算单】',
    `工作：${settlement.jobName}`,
    `周期：${start} – ${end}`,
    `出勤：${settlement.days} 天${
      isFixedMonthly ? ` · 休息：${settlement.restDays ?? 0} 天` : ''
    } · 工时：${settlement.hours} 小时${
      settlement.otHours > 0 ? ` · 加班：${settlement.otHours} 小时` : ''
    }`,
    `${isFixedMonthly ? '固定月薪' : '基础工资'}：${formatMoney(settlement.base, {
      symbol: true,
    })}`,
    `加班工资：${formatMoney(settlement.otPay, { symbol: true })}`,
    `奖金：${formatMoney(settlement.bonus + settlement.extraBonus, { symbol: true })}`,
    `扣款：${formatMoney(settlement.deduction + settlement.extraDeduction, { symbol: true })}`,
    ...(settlement.overRestDeduction
      ? [
          `超休扣款：${formatMoney(settlement.overRestDeduction, {
            symbol: true,
          })}（超休 ${settlement.overRestDays ?? 0} 天）`,
        ]
      : []),
    `借支抵扣：${formatMoney(settlement.advanceTotal, { symbol: true })}`,
    `应发净额：${formatMoney(settlement.net, { symbol: true })}`,
    `收款：${PAYMENT_STATUS_LABEL[paymentStatusOf(settlement)]} · 已收 ${formatMoney(
      paidAmountOf(settlement),
      { symbol: true },
    )} · 待收 ${formatMoney(remainingAmountOf(settlement), { symbol: true })}`,
  ];
  if (settlement.note) lines.push(`备注：${settlement.note}`);
  lines.push('—— 薪时 · 每一小时都算数');
  return lines.join('\n');
}
