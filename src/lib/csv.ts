import type { Entry, Job, Period, RestDay, Settlement } from '../types';
import { eachDay, weekdayCN } from './date';
import { formatHours } from './money';
import { formatRestDays, restDayAmount, totalRestDays } from './rest';
import { PAYMENT_STATUS_LABEL, paidAmountOf, paymentStatusOf, remainingAmountOf } from './payment';

function cell(value: string | number): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

/** 月度考勤 CSV：日期 × 岗位，每格为「班 6h / 休 0.5 / 未记」。 */
export function buildAttendanceCsv(
  jobs: Job[],
  entries: Entry[],
  rests: RestDay[],
  period: Period,
): string {
  const header = ['日期', '星期', ...jobs.map((job) => job.name), '当日工时'];
  const rows: Array<Array<string | number>> = [header];
  const entryByJobDate = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = `${entry.jobId}|${entry.date}`;
    const list = entryByJobDate.get(key);
    if (list) list.push(entry);
    else entryByJobDate.set(key, [entry]);
  }
  const restByJobDate = new Map(
    rests.map((rest) => [`${rest.jobId}|${rest.date}`, rest]),
  );
  for (const date of eachDay(period.start, period.end)) {
    const row: Array<string | number> = [
      date,
      weekdayCN(date),
    ];
    let dayHours = 0;
    for (const job of jobs) {
      const key = `${job.id}|${date}`;
      const dayEntries = entryByJobDate.get(key) ?? [];
      const rest = restByJobDate.get(key);
      if (dayEntries.length > 0) {
        const hours = dayEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0);
        dayHours += hours;
        row.push(`班 ${formatHours(hours)}h`);
      } else if (rest) {
        row.push(`休 ${formatRestDays(restDayAmount(rest))}`);
      } else {
        row.push('未记');
      }
    }
    row.push(formatHours(dayHours));
    rows.push(row);
  }
  const summary: Array<string | number> = ['合计', ''];
  let totalHours = 0;
  for (const job of jobs) {
    const jobEntries = entries.filter((entry) => entry.jobId === job.id);
    const jobRests = rests.filter((rest) => rest.jobId === job.id);
    const hours = jobEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0);
    totalHours += hours;
    summary.push(
      `${new Set(jobEntries.map((entry) => entry.date)).size} 班 / ${formatRestDays(
        totalRestDays(jobRests),
      )} 休 / ${formatHours(hours)}h`,
    );
  }
  summary.push(formatHours(totalHours));
  rows.push(summary);
  return `\uFEFF${buildCsv(rows)}`;
}

export function buildSettlementCsv(settlements: Settlement[]): string {  const rows: Array<Array<string | number>> = [
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
