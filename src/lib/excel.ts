import type { AppState, Settlement } from '../types';
import { monthKey, weekdayCN } from './date';
import { round2 } from './money';
import { payForEntry } from './pay';
import { paidAmountOf, paymentStatusOf, remainingAmountOf } from './payment';
import { sumEntriesCapped } from './settlement';
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
      '基础工资',
      '加班工资',
      '奖金',
      '扣款',
      '合计',
      '节假日',
      '结算状态',
      '单号',
      '备注',
    ],
  ];
  const sortedEntries = [...state.entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  for (const entry of sortedEntries) {
    const job = jobMap.get(entry.jobId);
    const pay = payForEntry(entry);
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
      money(pay.base),
      money(pay.otPay),
      money(pay.bonus),
      money(pay.deduction),
      money(pay.total),
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

  const unsettledByJobMonth = new Map<string, AppState['entries']>();
  for (const entry of state.entries) {
    if (settledEntries.has(entry.id)) continue;
    const key = `${monthKey(entry.date)}|${entry.jobId}`;
    const group = unsettledByJobMonth.get(key);
    if (group) group.push(entry);
    else unsettledByJobMonth.set(key, [entry]);
  }

  for (const [key, entries] of unsettledByJobMonth) {
    const [month, jobId] = key.split('|');
    const job = jobMap.get(jobId);
    const totals = sumEntriesCapped(entries);
    // 已结算行已计入的休息日这里排除，避免重复计入；未提供休息信息的旧结算单不做排除。
    const jobSettlements = state.settlements.filter((item) => item.jobId === jobId);
    const countedInSettled = (rest: AppState['restDays'][number]): boolean =>
      jobSettlements.some((item) => {
        if (item.restDates) return item.restDates.includes(rest.date);
        if (item.restDays !== undefined) {
          return rest.date >= item.periodStart && rest.date <= item.periodEnd;
        }
        return false;
      });
    const restDays = state.restDays
      .filter((rest) => rest.jobId === jobId && monthKey(rest.date) === month)
      .filter((rest) => !countedInSettled(rest))
      .reduce((sum, rest) => sum + (rest.days ?? 1), 0);
    summaryRows.push([
      month,
      job?.name ?? '已删除工作',
      totals.days,
      round2(restDays),
      hours(totals.hours),
      hours(totals.otHours),
      money(totals.base),
      money(totals.otPay),
      money(totals.bonus),
      money(totals.deduction),
      money(0),
      money(0),
      money(0),
      money(totals.total),
      paymentState(entries, settledEntries),
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
          (total, item) => total + (item.restDays ?? item.restDates?.length ?? 0),
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
      columns: [11, 7, 14, 14, 7, 7, 9, 8, 9, 9, 9, 11, 11, 9, 9, 11, 8, 10, 10, 24],
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
