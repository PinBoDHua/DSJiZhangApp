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
  endOfMonth,
  formatDateShort,
  formatDateWithWeekday,
  daysInMonth,
  monthKey,
  periodContains,
  periodOf,
  startOfMonth,
  todayISO,
} from './date';
import { formatMoney, round2 } from './money';
import { payForEntry } from './pay';
import { restDayAmount } from './rest';
import { settlementChecksum } from './checksum';
import { findSettlementOverlap } from './guards';
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
  const baseDays = new Set<string>();
  let base = 0;
  let otPay = 0;
  let bonus = 0;
  let deduction = 0;
  let hours = 0;
  let otHours = 0;

  for (const entry of entries) {
    const pay = payForEntry(entry);
    // 日薪 / 月薪同一天多段只计一次基础工资，与 sumEntriesCapped 的封顶口径保持一致。
    const payType = entry.rule.payType;
    const perDayBase = payType === 'daily' || payType === 'monthly';
    const baseKey = `${payType}|${entry.jobId}|${entry.date}`;
    const includeBase = !perDayBase || !baseDays.has(baseKey);
    if (perDayBase) baseDays.add(baseKey);
    if (includeBase) base += pay.base;
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
 * 传入非自然月结算周期时，固定月薪同样按实际出勤天数折算；未传周期保留月度汇总口径。
 */
export function sumEntriesCapped(entries: Entry[], period?: Period): Totals {
  const monthlyGroups = new Map<string, Entry[]>();
  const regular: Entry[] = [];
  const dailyBaseDays = new Set<string>();
  const isWholeCalendarMonth =
    !period ||
    (period.start === startOfMonth(period.start) && period.end === endOfMonth(period.start));

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

  for (const entry of regular) {
    const dailyKey = `${entry.jobId}|${entry.date}`;
    const includeBase = entry.rule.payType !== 'daily' || !dailyBaseDays.has(dailyKey);
    if (entry.rule.payType === 'daily') dailyBaseDays.add(dailyKey);
    consume(entry, includeBase);
  }

  for (const group of monthlyGroups.values()) {
    // 同一天多段工记只取当天最新快照；调价不能回写当月其他日期的历史规则。
    const byDate = new Map<string, Entry>();
    for (const entry of group) {
      const current = byDate.get(entry.date);
      if (!current || entry.createdAt >= current.createdAt) byDate.set(entry.date, entry);
    }
    const dailyRules = Array.from(byDate.values());
    const first = dailyRules[0] ?? group[0];
    const sameTerms = dailyRules.every(
      (entry) =>
        entry.rule.monthlyMode === first.rule.monthlyMode &&
        entry.rule.rate === first.rule.rate &&
        entry.rule.expectedDays === first.rule.expectedDays,
    );
    const rawBase = dailyRules.reduce((sum, entry) => {
      const expectedDays = entry.rule.expectedDays > 0 ? entry.rule.expectedDays : 22;
      return sum + Math.max(0, entry.rule.rate) / expectedDays;
    }, 0);
    const rate = Math.max(0, first.rule.rate);
    const cap = sameTerms
      ? rate
      : Math.max(...dailyRules.map((entry) => Math.max(0, entry.rule.rate)), 0);
    const fullFixedMonth =
      sameTerms && first.rule.monthlyMode === 'fixed' && isWholeCalendarMonth;
    const paidBase = fullFixedMonth ? rate : Math.min(rawBase, cap);
    totals.base += round2(paidBase);
    totals.capAdjustment += fullFixedMonth ? 0 : Math.max(0, rawBase - cap);
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

  const totals = sumEntriesCapped(jobEntries, period);
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
  const periodRestDays = restDays
    .filter(
      (rest) =>
        rest.jobId === job.id && periodContains(period, rest.date),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const periodRestDates = Array.from(
    new Set(periodRestDays.map((rest) => rest.date)),
  ).sort();
  const restAmountByDate = new Map<string, number>();
  for (const rest of periodRestDays) {
    if (!restAmountByDate.has(rest.date)) {
      restAmountByDate.set(rest.date, restDayAmount(rest));
    }
  }
  const restCount = round2(
    Array.from(restAmountByDate.values()).reduce((sum, amount) => sum + amount, 0),
  );
  const isFixedMonthly = payType === 'monthly' && monthlyMode === 'fixed';
  const policy = job.rule;
  const historicalPolicy = latestEntry?.rule ?? job.rule;
  const isFlexibleRest =
    isFixedMonthly && (policy.restPolicy ?? 'quota') === 'flexible';
  // 超休额度是「每月」口径。非整月周期（导入的固定月薪工作可能出现）按周期占当月的
  // 比例折算，否则每个短周期都重置一整月额度，会系统性少扣超休。整月周期比例恰为 1，口径不变。
  const periodDayCount = eachDay(period.start, period.end).length;
  const restQuota =
    Math.max(0, policy.restDaysPerMonth) *
    (periodDayCount / Math.max(1, daysInMonth(period.start)));
  const overRestDays =
    isFixedMonthly && !isFlexibleRest
      ? round2(Math.max(0, restCount - restQuota))
      : 0;
  const dailyRate =
    policy.overRestDailyRate > 0
      ? policy.overRestDailyRate
      : historicalPolicy.rate / Math.max(1, historicalPolicy.expectedDays);
  const autoOverRestDeduction = round2(overRestDays * dailyRate);
  const overRestDeduction =
    isFixedMonthly &&
    !isFlexibleRest &&
    policy.overRestDeduct &&
    overRestEnabled &&
    overRestDays > 0
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
    restDates: periodRestDates,
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
    restDates: draft.restDates,
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

export interface SettlementCommitInput {
  jobId: string;
  period: Period;
  extraBonus: number;
  extraDeduction: number;
  note?: string;
  overRestEnabled?: boolean;
  overRestAmount?: number;
  settlementId: string;
  createdAt: string;
}

/** 纯函数原子提交：校验、生成结算并同步绑定工记和借支，不修改输入状态。 */
export function commitSettlement(
  state: AppState,
  input: SettlementCommitInput,
): { state: AppState; settlement: Settlement } | null {
  const job = state.jobs.find((item) => item.id === input.jobId);
  if (!job || findSettlementOverlap(state.settlements, input.jobId, input.period)) return null;
  const draft = buildSettlementDraft(
    job,
    state.entries,
    state.advances,
    input.period,
    input.extraBonus,
    input.extraDeduction,
    state.restDays,
    input.overRestEnabled,
    input.overRestAmount,
  );
  if (draft.entries.length === 0) return null;
  const settlement = makeSettlement(
    draft,
    input.settlementId,
    input.createdAt,
    input.note?.trim() || undefined,
  );
  const entryIds = new Set(draft.entryIds);
  const advanceIds = new Set(draft.advanceIds);
  return {
    settlement,
    state: {
      ...state,
      settlements: [settlement, ...state.settlements],
      entries: state.entries.map((entry) =>
        entryIds.has(entry.id)
          ? { ...entry, settlementId: settlement.id, updatedAt: input.createdAt }
          : entry,
      ),
      advances: state.advances.map((advance) =>
        advanceIds.has(advance.id) ? { ...advance, settlementId: settlement.id } : advance,
      ),
    },
  };
}

export interface DailyPoint {
  date: string;
  earnings: number;
  hours: number;
}

export function dailySeries(entries: Entry[], start: string, end: string): DailyPoint[] {
  const map = new Map<string, DailyPoint>();
  const dailyBaseDays = new Set<string>();
  const monthlyGroups = new Map<string, Entry[]>();
  for (const day of eachDay(start, end)) {
    map.set(day, { date: day, earnings: 0, hours: 0 });
  }
  // 先按窗口过滤：窗口外的同月月薪记录会参与分摊，稀释窗口内每日金额。
  const inWindow = entries.filter((entry) => entry.date >= start && entry.date <= end);
  for (const entry of inWindow) {
    const point = map.get(entry.date);
    if (!point) continue;
    if (entry.rule.payType === 'monthly') {
      const key = `${entry.jobId}|${monthKey(entry.date)}`;
      const group = monthlyGroups.get(key);
      if (group) group.push(entry);
      else monthlyGroups.set(key, [entry]);
      continue;
    }
    const pay = payForEntry(entry);
    const dailyKey = `${entry.jobId}|${entry.date}`;
    const includeBase = entry.rule.payType !== 'daily' || !dailyBaseDays.has(dailyKey);
    if (entry.rule.payType === 'daily') dailyBaseDays.add(dailyKey);
    point.earnings = round2(point.earnings + pay.total - (includeBase ? 0 : pay.base));
    point.hours = round2(point.hours + (entry.hours || 0));
  }

  // 月薪按本期目标基础工资分摊到实际出勤日，保证图表之和与上方合计一致。
  const period: Period = { start, end, key: `series:${start}`, label: '', shortLabel: '' };
  for (const group of monthlyGroups.values()) {
    const targetBase = sumEntriesCapped(group, period).base;
    const byDate = new Map<string, Entry[]>();
    for (const entry of group) {
      const list = byDate.get(entry.date);
      if (list) list.push(entry);
      else byDate.set(entry.date, [entry]);
    }
    const rawByDate = new Map<string, number>();
    let rawTotal = 0;
    for (const [date, dayEntries] of byDate) {
      const latest = dayEntries.reduce(
        (best, item) => (item.createdAt >= best.createdAt ? item : best),
        dayEntries[0],
      );
      const expectedDays = latest.rule.expectedDays > 0 ? latest.rule.expectedDays : 22;
      const raw = Math.max(0, latest.rule.rate) / expectedDays;
      rawByDate.set(date, raw);
      rawTotal += raw;
    }
    // 逐日先舍入再累加会漂移 1–2 分；最后一天吃掉余数，保证图表之和精确等于合计。
    const dates = Array.from(byDate.keys()).sort();
    let allocated = 0;
    dates.forEach((date, index) => {
      const dayEntries = byDate.get(date) ?? [];
      const point = map.get(date);
      const raw = rawByDate.get(date) ?? 0;
      const isLast = index === dates.length - 1;
      const base = isLast
        ? round2(targetBase - allocated)
        : round2(rawTotal > 0 ? (targetBase * raw) / rawTotal : 0);
      allocated = round2(allocated + base);
      if (!point) return;
      let additions = base;
      for (const entry of dayEntries) {
        const pay = payForEntry(entry);
        additions += pay.otPay + pay.bonus - pay.deduction;
        point.hours = round2(point.hours + (entry.hours || 0));
      }
      point.earnings = round2(point.earnings + additions);
    });
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
  const isMonthly = settlement.payType === 'monthly';
  const restDates = settlement.restDates ?? [];
  const lines = [
    '【薪时 · 结算单】',
    `工作：${settlement.jobName}`,
    `周期：${start} – ${end}`,
    `出勤：${settlement.days} 天${
      isMonthly ? ` · 休息：${settlement.restDays ?? 0} 天` : ''
    } · 工时：${settlement.hours} 小时${
      settlement.otHours > 0 ? ` · 加班：${settlement.otHours} 小时` : ''
    }`,
    ...(isMonthly && restDates.length > 0
      ? [`休息日：${restDates.map(formatDateShort).join('、')}`]
      : []),
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
    `校验码：${settlementChecksum(settlement)}`,
    `收款：${PAYMENT_STATUS_LABEL[paymentStatusOf(settlement)]} · 已收 ${formatMoney(
      paidAmountOf(settlement),
      { symbol: true },
    )} · 待收 ${formatMoney(remainingAmountOf(settlement), { symbol: true })}`,
  ];
  if (settlement.note) lines.push(`备注：${settlement.note}`);
  lines.push('—— 薪时 · 每一小时都算数');
  return lines.join('\n');
}
