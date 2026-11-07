import type { Entry, Job, PayType, Period, RestDay, Settlement } from '../types';
import { eachDay, weekdayCN } from './date';
import { formatHours, round2 } from './money';
import { PAY_TYPE_LABEL } from './meta';
import { payForEntry } from './pay';
import { formatRestDays, restDayAmount, totalRestDays } from './rest';
import { PAYMENT_STATUS_LABEL, paidAmountOf, paymentStatusOf, remainingAmountOf } from './payment';

function cell(value: string | number): string {
  let text = String(value ?? '');
  // CSV 会交给 Excel / WPS 打开，文本开头不能被执行成公式。
  if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

export interface EntryCsvOptions {
  start?: string;
  end?: string;
  jobId?: string;
  payType?: PayType;
}

/** 全量工记 + 计薪快照。只含有效工记，不含回收站或照片本体，不能替代 JSON 恢复备份。 */
export function buildEntryCsv(
  entries: Entry[],
  jobs: Job[],
  options: EntryCsvOptions = {},
): string {
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const rows: Array<Array<string | number>> = [
    [
      '记录ID', '工作ID', '工作名称(当前)', '雇主(当前)', '日期', '星期',
      '开始', '结束', '休息分钟', '工时', '计件数量', '加班工时',
      '奖金', '扣款', '节假日', '备注', '照片ID(不含照片)', '结算ID',
      '周期规则ID', '创建时间', '更新时间', '计薪类型', '单价',
      '标准工时', '月计薪天数', '月薪模式', '月休额度', '休息规则',
      '超休扣款开关', '超休日扣款', '计件单位', '加班开关',
      '平日加班倍率', '周末加班倍率', '节假日加班倍率',
      '基础工资(单笔折算参考)', '加班工资(参考)', '合计(单笔折算参考)',
    ],
  ];
  const filtered = entries
    .filter((entry) => !options.start || entry.date >= options.start)
    .filter((entry) => !options.end || entry.date <= options.end)
    .filter((entry) => !options.jobId || entry.jobId === options.jobId)
    .filter((entry) => !options.payType || entry.rule.payType === options.payType)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const entry of filtered) {
    const job = jobMap.get(entry.jobId);
    const rule = entry.rule;
    const pay = payForEntry(entry);
    rows.push([
      entry.id, entry.jobId, job?.name ?? '已删除工作', job?.employer ?? '',
      entry.date, weekdayCN(entry.date), entry.startTime ?? '', entry.endTime ?? '',
      entry.breakMinutes, entry.hours, entry.quantity, entry.otHours,
      entry.bonus, entry.deduction, entry.holiday ? '是' : '否', entry.note ?? '',
      entry.photoId ?? '', entry.settlementId ?? '', entry.recurringRuleId ?? '',
      entry.createdAt, entry.updatedAt, PAY_TYPE_LABEL[rule.payType], rule.rate,
      rule.standardHours, rule.expectedDays,
      rule.monthlyMode === 'fixed' ? '固定月薪' : '按出勤折算',
      rule.restDaysPerMonth, rule.restPolicy === 'flexible' ? '随机休息' : '固定额度',
      rule.overRestDeduct ? '是' : '否', rule.overRestDailyRate, rule.unitLabel,
      rule.otEnabled ? '是' : '否', rule.weekdayOT, rule.weekendOT, rule.holidayOT,
      round2(pay.base), round2(pay.otPay), round2(pay.total),
    ]);
  }
  return `\uFEFF${buildCsv(rows)}`;
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
