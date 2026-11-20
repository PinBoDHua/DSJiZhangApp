import type { AppState, Period, Settlement } from '../types';
import { comparePeriods, monthKey, periodOf, weekdayCN } from './date';
import { round2 } from './money';
import { payForEntry } from './pay';
import { paidAmountOf, paymentStatusOf, remainingAmountOf } from './payment';
import { restDayAmount } from './rest';
import {
  addSettledUsage,
  buildSettlementDraft,
  dailyBaseEntryIds,
  settledBaseByMonth,
  totalAdvanceAmount,
} from './settlement';
import { buildXlsx, type XlsxCellValue, type XlsxSheet } from './xlsx';

function money(value: number): XlsxCellValue {
  return { value: round2(value), style: 'money' };
}

function hours(value: number): XlsxCellValue {
  return { value: round2(value), style: 'hours' };
}

function statusLabel(status?: string): string {
  if (status === 'paid') return '已发';
  if (status === 'partial') return '部分发放';
  return '待发';
}

function settlementStatus(settlement: Settlement): string {
  return statusLabel(paymentStatusOf(settlement));
}

/**
 * 结算单休息天数：旧结算单可能只有 restDates 没有 restDays。
 * 按休息记录求和（半天算 0.5），找不到记录的日期按整天保守估算，不再把日期数直接当整天。
 */
function settlementRestDays(
  settlement: Settlement,
  restDays: AppState['restDays'],
): number {
  if (settlement.restDays !== undefined) return settlement.restDays;
  let total = 0;
  for (const date of settlement.restDates ?? []) {
    const rest = restDays.find(
      (item) => item.jobId === settlement.jobId && item.date === date,
    );
    total += rest ? restDayAmount(rest) : 1;
  }
  return round2(total);
}

function paymentState(entries: AppState['entries'], settledEntries: Set<string>): string {
  if (entries.length === 0) return '未结（预估）';
  const settled = entries.filter((entry) => settledEntries.has(entry.id)).length;
  if (settled === entries.length) return '已结';
  if (settled === 0) return '未结（预估）';
  return '部分已结';
}

export function buildLedgerSheets(state: AppState): XlsxSheet[] {
  const jobMap = new Map(state.jobs.map((job) => [job.id, job]));
  const settlementMap = new Map(state.settlements.map((item) => [item.id, item]));
  // 结算状态以结算单 entryIds 为准：孤儿 settlementId（结算已删）不算已结算，与汇总口径一致。
  const settledEntries = new Set(
    state.settlements.flatMap((settlement) => settlement.entryIds),
  );

  const detailRows: XlsxCellValue[][] = [
    [
      '日期',
      '星期',
      '工作',
      '雇主',
      '开始',
      '结束',
      '休息(分)',
      '工时',
      '加班工时',
      '计件数量',
      '单价',
      '基础工资(单日仅计一次)',
      '加班工资',
      '奖金',
      '扣款',
      '合计(单笔折算参考)',
      '节假日',
      '结算状态',
      '单号',
      '备注',
    ],
  ];
  const sortedEntries = [...state.entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  // 基础工资按「同一天多段只计一次」口径，与结算 / 统计一致，避免明细同日多段重复加总。
  const baseEntryIds = dailyBaseEntryIds(state.entries);
  for (const entry of sortedEntries) {
    const job = jobMap.get(entry.jobId);
    const pay = payForEntry(entry);
    const perDayBase =
      entry.rule.payType === 'daily' || entry.rule.payType === 'monthly';
    const includeBase = !perDayBase || baseEntryIds.has(entry.id);
    detailRows.push([
      entry.date,
      weekdayCN(entry.date),
      job?.name ?? '已删除工作',
      job?.employer ?? '',
      entry.startTime ?? '',
      entry.endTime ?? '',
      entry.breakMinutes ?? 0,
      hours(entry.hours),
      hours(pay.otHours),
      entry.quantity ?? 0,
      money(entry.rule.rate),
      money(includeBase ? pay.base : 0),
      money(pay.otPay),
      money(pay.bonus),
      money(pay.deduction),
      money(includeBase ? pay.total : round2(pay.total - pay.base)),
      entry.holiday ? '是' : '',
      settledEntries.has(entry.id) ? '已结算' : '未结算',
      settledEntries.has(entry.id) && entry.settlementId ? entry.settlementId.slice(-8) : '',
      entry.note ?? '',
    ]);
  }

  const summaryRows: XlsxCellValue[][] = [
    [
      '月份',
      '工作',
      '出勤天数',
      '休息天数',
      '工时',
      '加班工时',
      '基础',
      '加班费',
      '奖金',
      '扣款',
      '超休扣款',
      '借支抵扣',
      '额外奖扣',
      '应发',
      '状态',
    ],
  ];

  // 未结行与 App 的「待结」同一口径：按「岗位 × 结算周期」逐期汇总（复用 buildSettlementDraft），
  // 不再按整自然月估固定月薪；超休扣款按整月周期计，借支挂在最早未结周期的月份行上。
  // 已结算判定统一用结算单 entryIds 集合：孤儿 settlementId（结算单已删）仍算未结。
  const openEntries = state.entries
    .filter((entry) => !settledEntries.has(entry.id))
    .map((entry) => (entry.settlementId ? { ...entry, settlementId: undefined } : entry));
  interface UnsettledRow {
    month: string;
    jobId: string;
    jobName: string;
    days: number;
    hours: number;
    otHours: number;
    base: number;
    otPay: number;
    bonus: number;
    deduction: number;
    overRestDeduction: number;
    advanceTotal: number;
    net: number;
  }
  const unsettledRowsByKey = new Map<string, UnsettledRow>();
  for (const job of state.jobs) {
    const jobOpenEntries = openEntries.filter((entry) => entry.jobId === job.id);
    if (jobOpenEntries.length === 0) continue;
    const periods = new Map<string, Period>();
    for (const entry of jobOpenEntries) {
      const period = periodOf(job.cycle, entry.date, state.settings.weekStartsOn);
      if (!periods.has(period.key)) periods.set(period.key, period);
    }
    let firstKey: string | null = null;
    // B01：Excel 预估与结算同一口径——按结算顺序累计消耗同月额度，避免每期都拿满月薪。
    const simulated = settledBaseByMonth(state.entries, job.id);
    for (const period of Array.from(periods.values()).sort(comparePeriods)) {
      const draft = buildSettlementDraft(
        job,
        openEntries,
        [],
        period,
        0,
        0,
        state.restDays,
        job.rule.overRestDeduct,
        undefined,
        simulated,
      );
      if (draft.entries.length === 0) continue;
      addSettledUsage(simulated, job.id, draft.entries);
      const month = monthKey(period.end);
      const key = `${month}|${job.id}`;
      if (!firstKey) firstKey = key;
      const row = unsettledRowsByKey.get(key) ?? {
        month,
        jobId: job.id,
        jobName: job.name,
        days: 0,
        hours: 0,
        otHours: 0,
        base: 0,
        otPay: 0,
        bonus: 0,
        deduction: 0,
        overRestDeduction: 0,
        advanceTotal: 0,
        net: 0,
      };
      row.days += draft.days;
      row.hours += draft.hours;
      row.otHours += draft.otHours;
      row.base += draft.base;
      row.otPay += draft.otPay;
      row.bonus += draft.bonus;
      row.deduction += draft.deduction;
      row.overRestDeduction += draft.overRestDeduction;
      row.net += draft.net;
      unsettledRowsByKey.set(key, row);
    }
    const jobAdvances = state.advances.filter(
      (advance) => advance.jobId === job.id && !advance.settlementId,
    );
    const advanceTotal = totalAdvanceAmount(jobAdvances);
    const firstRow = firstKey ? unsettledRowsByKey.get(firstKey) : undefined;
    if (firstRow && advanceTotal > 0) {
      firstRow.advanceTotal += advanceTotal;
      firstRow.net -= advanceTotal;
    }
  }
  const sortedUnsettledRows = Array.from(unsettledRowsByKey.values()).sort(
    (a, b) => a.month.localeCompare(b.month) || a.jobName.localeCompare(b.jobName),
  );
  for (const row of sortedUnsettledRows) {
    // 已结算行已计入的休息日这里排除，避免重复计入；未提供休息信息的旧结算单不做排除。
    const jobSettlements = state.settlements.filter((item) => item.jobId === row.jobId);
    const countedInSettled = (rest: AppState['restDays'][number]): boolean =>
      jobSettlements.some((item) => {
        if (item.restDates) return item.restDates.includes(rest.date);
        if (item.restDays !== undefined) {
          return rest.date >= item.periodStart && rest.date <= item.periodEnd;
        }
        return false;
      });
    const restDays = state.restDays
      .filter((rest) => rest.jobId === row.jobId && monthKey(rest.date) === row.month)
      .filter((rest) => !countedInSettled(rest))
      .reduce((sum, rest) => sum + restDayAmount(rest), 0);
    const monthEntries = openEntries.filter(
      (entry) => entry.jobId === row.jobId && monthKey(entry.date) === row.month,
    );
    summaryRows.push([
      row.month,
      row.jobName,
      row.days,
      round2(restDays),
      hours(row.hours),
      hours(row.otHours),
      money(row.base),
      money(row.otPay),
      money(row.bonus),
      money(row.deduction),
      money(row.overRestDeduction),
      money(row.advanceTotal),
      money(0),
      money(row.net),
      paymentState(monthEntries, settledEntries),
    ]);
  }

  const settledByJobMonth = new Map<string, Settlement[]>();
  for (const settlement of state.settlements) {
    const key = `${monthKey(settlement.periodEnd)}|${settlement.jobId}`;
    const group = settledByJobMonth.get(key);
    if (group) group.push(settlement);
    else settledByJobMonth.set(key, [settlement]);
  }
  for (const [key, settlements] of settledByJobMonth) {
    const [month, jobId] = key.split('|');
    const job = jobMap.get(jobId);
    const sum = (pick: (item: Settlement) => number) =>
      round2(settlements.reduce((total, item) => total + pick(item), 0));
    summaryRows.push([
      month,
      job?.name ?? settlements[0].jobName,
      settlements.reduce((total, item) => total + item.days, 0),
      round2(
        settlements.reduce(
          (total, item) => total + settlementRestDays(item, state.restDays),
          0,
        ),
      ),
      hours(sum((item) => item.hours)),
      hours(sum((item) => item.otHours)),
      money(sum((item) => item.base)),
      money(sum((item) => item.otPay)),
      money(sum((item) => item.bonus)),
      money(sum((item) => item.deduction)),
      money(sum((item) => item.overRestDeduction ?? 0)),
      money(sum((item) => item.advanceTotal)),
      money(sum((item) => item.extraBonus - item.extraDeduction)),
      money(sum((item) => item.net)),
      '已结',
    ]);
  }

  const settlementRows: XlsxCellValue[][] = [
    [
      '周期开始',
      '周期结束',
      '工作',
      '基础',
      '加班',
      '奖金',
      '扣款',
      '超休扣款',
      '借支抵扣',
      '额外奖',
      '额外扣',
      '应发',
      '已收',
      '待收',
      '收款状态',
      '备注',
    ],
  ];
  const sortedSettlements = [...state.settlements].sort(
    (a, b) => a.periodStart.localeCompare(b.periodStart) || a.createdAt.localeCompare(b.createdAt),
  );
  for (const settlement of sortedSettlements) {
    settlementRows.push([
      settlement.periodStart,
      settlement.periodEnd,
      settlement.jobName,
      money(settlement.base),
      money(settlement.otPay),
      money(settlement.bonus),
      money(settlement.deduction),
      money(settlement.overRestDeduction ?? 0),
      money(settlement.advanceTotal),
      money(settlement.extraBonus),
      money(settlement.extraDeduction),
      money(settlement.net),
      money(paidAmountOf(settlement)),
      money(remainingAmountOf(settlement)),
      settlementStatus(settlement),
      settlement.note ?? '',
    ]);
  }

  const advanceRows: XlsxCellValue[][] = [
    ['日期', '工作', '金额', '是否已抵扣', '结算周期', '备注'],
  ];
  const sortedAdvances = [...state.advances].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  for (const advance of sortedAdvances) {
    const job = jobMap.get(advance.jobId);
    const settlement = advance.settlementId
      ? settlementMap.get(advance.settlementId)
      : undefined;
    advanceRows.push([
      advance.date,
      job?.name ?? '已删除工作',
      money(advance.amount),
      settlement ? '已抵扣' : '未抵扣',
      settlement ? `${settlement.periodStart} 至 ${settlement.periodEnd}` : '',
      advance.note ?? '',
    ]);
  }

  return [
    {
      name: '工记明细',
      columns: [11, 7, 14, 14, 7, 7, 9, 8, 9, 9, 9, 18, 11, 9, 9, 18, 8, 10, 10, 24],
      rows: detailRows,
    },
    {
      name: '月度汇总',
      columns: [9, 16, 9, 9, 8, 9, 11, 11, 10, 9, 10, 10, 11, 11, 13],
      rows: summaryRows,
    },
    {
      name: '结算单',
      columns: [11, 11, 16, 11, 11, 10, 9, 10, 10, 9, 9, 11, 11, 11, 10, 24],
      rows: settlementRows,
    },
    {
      name: '借支',
      columns: [11, 16, 11, 10, 24, 24],
      rows: advanceRows,
    },
  ];
}

export async function buildLedgerXlsx(state: AppState): Promise<Uint8Array> {
  return buildXlsx(buildLedgerSheets(state));
}

export function excelFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `薪时账本-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.xlsx`;
}
