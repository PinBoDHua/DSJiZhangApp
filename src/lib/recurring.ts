import type { AppState, Entry, Job, RecurringRule } from '../types';
import { addDays, daysInMonth, hoursBetween, nowISO, todayISO } from './date';
import { wouldExceedDayLimit } from './guards';
import { round2 } from './money';
import { autoOtHours } from './pay';

export type NewRecurringRuleInput = Omit<
  RecurringRule,
  'id' | 'createdAt' | 'updatedAt' | 'lastProcessedDate'
>;

export interface RecurringMaterializeOptions {
  today?: string;
  includeToday?: boolean;
  automaticOnly?: boolean;
  ruleId?: string;
  now?: string;
  createId?: () => string;
  /** 首次补记最多回溯多少天，默认 120；规则开始日期更早时只补最近这段。 */
  backfillDays?: number;
}

/**
 * 首次补记回溯上限。没有游标的规则从「开始日期」和「今天往前 N 天」中较晚的一天开始，
 * 避免把几个月甚至几年的规则日一次性补成几千条工记（真机会明显卡顿，也难核对）。
 */
export const RECURRING_BACKFILL_DAYS = 120;

export interface RecurringMaterializeResult {
  state: AppState;
  added: number;
  skipped: number;
  /** 规则开始日期早于回溯窗口，更早的规则日已放弃，不再补记。 */
  truncated: boolean;
  /** 日薪 / 月薪规则 hours=0 仍生成全额计薪工记的条数，供 UI 提示「按 1 个出勤日计薪」。 */
  zeroHourEntries: number;
  /** 单价 <= 0 被跳过且未推进游标的规则日数；改回单价后会重新补记，不再永久漏补。 */
  paySkipped: number;
  /** 规则开始日期早于已处理游标：更早的日期不会回补（设计如此），供 UI 提示。 */
  startDateBehindCursor: boolean;
}

export function ruleMatchesDate(rule: RecurringRule, date: string): boolean {
  if (date < rule.startDate || (rule.endDate && date > rule.endDate)) return false;
  if (rule.frequency === 'daily') return true;
  if (rule.frequency === 'weekly') {
    const [year, month, day] = date.split('-').map(Number);
    return rule.weekdays.includes(new Date(year, month - 1, day).getDay());
  }
  return Number(date.slice(8)) === Math.min(rule.dayOfMonth, daysInMonth(date));
}

export function recurringRuleLabel(rule: RecurringRule): string {
  if (rule.frequency === 'daily') return '每天';
  if (rule.frequency === 'monthly') return `每月 ${rule.dayOfMonth} 日（无此日期则月末）`;
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return rule.weekdays.map((day) => names[day]).join('、') || '每周（未选日期）';
}

export function nextRecurringDate(rule: RecurringRule, from = todayISO()): string | null {
  const start = rule.startDate > from ? rule.startDate : from;
  for (let offset = 0; offset < 370; offset += 1) {
    const date = addDays(start, offset);
    if (rule.endDate && date > rule.endDate) return null;
    if (ruleMatchesDate(rule, date)) return date;
  }
  return null;
}

function entryFromRule(
  rule: RecurringRule,
  job: Job,
  date: string,
  timestamp: string,
  id: string,
): Entry | null {
  if (job.rule.rate <= 0) return null;
  const hours = round2(Math.max(0, rule.hours));
  const quantity = round2(Math.max(0, rule.quantity));
  if (hours > 24 || (job.rule.payType === 'hourly' && hours <= 0)) return null;
  if (job.rule.payType === 'piece' && quantity <= 0) return null;
  const defaultHours = hoursBetween(
    job.shift.startTime,
    job.shift.endTime,
    job.shift.breakMinutes,
  );
  const keepTimes = job.rule.payType === 'hourly' && Math.abs(hours - defaultHours) < 0.001;
  return {
    id,
    jobId: job.id,
    date,
    startTime: keepTimes ? job.shift.startTime : undefined,
    endTime: keepTimes ? job.shift.endTime : undefined,
    breakMinutes: keepTimes ? job.shift.breakMinutes : 0,
    hours,
    quantity: job.rule.payType === 'piece' ? quantity : 0,
    otHours:
      job.rule.payType === 'hourly' && job.rule.otEnabled
        ? autoOtHours(hours, job.rule)
        : 0,
    bonus: round2(Math.max(0, rule.bonus)),
    deduction: round2(Math.max(0, rule.deduction)),
    holiday: false,
    note: rule.note?.trim() || '周期记工',
    recurringRuleId: rule.id,
    rule: { ...job.rule },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * 原子生成到期工记。默认只补到昨天；同一天同岗位已有记录、休息、
 * 已结算或会超过 24 小时时跳过，并推进处理游标以免反复提示。
 */
export function materializeRecurring(
  source: AppState,
  options: RecurringMaterializeOptions = {},
): RecurringMaterializeResult {
  const today = options.today ?? todayISO();
  const horizon = options.includeToday ? today : addDays(today, -1);
  // 同一批生成的工记共用一个时间戳；结算 / 统计侧遇到 createdAt 并列时以 id 字典序兜底取最新快照。
  const timestamp = options.now ?? nowISO();
  const idFactory = options.createId ?? (() => `entry-recur-${Date.now()}-${Math.random()}`);
  const backfillDays = Math.max(
    1,
    Math.min(3700, Math.round(options.backfillDays ?? RECURRING_BACKFILL_DAYS)),
  );
  // 只允许补最近 backfillDays 天：游标更早（新规则或长时间没打开）时截断，避免一次生成上千条。
  const earliest = addDays(horizon, -(backfillDays - 1));
  let entries = source.entries;
  let rules = source.recurringRules ?? [];
  let changed = false;
  let added = 0;
  let skipped = 0;
  let truncated = false;
  let zeroHourEntries = 0;
  let paySkipped = 0;
  let startDateBehindCursor = false;

  for (const original of source.recurringRules ?? []) {
    if (!original.enabled || (options.automaticOnly && !original.auto)) continue;
    if (options.ruleId && original.id !== options.ruleId) continue;
    const job = source.jobs.find((item) => item.id === original.jobId && !item.archived);
    if (!job) continue;
    let rule = original;
    let cursor = rule.lastProcessedDate
      ? addDays(rule.lastProcessedDate, 1)
      : rule.startDate;
    if (cursor < earliest) {
      cursor = earliest;
      truncated = true;
    }
    if (cursor < rule.startDate) cursor = rule.startDate;
    if (rule.lastProcessedDate && rule.startDate <= rule.lastProcessedDate) {
      // 开始日期改成更早的日期后，游标之前的日子不会自动回补（设计如此），只返回提示。
      startDateBehindCursor = true;
    }
    let guard = 0;
    while (cursor <= horizon && guard <= backfillDays) {
      if (ruleMatchesDate(rule, cursor) && (!rule.lastProcessedDate || cursor > rule.lastProcessedDate)) {
        const duplicate = entries.some(
          (entry) =>
            (entry.recurringRuleId === rule.id && entry.date === cursor) ||
            (entry.jobId === rule.jobId && entry.date === cursor),
        );
        const settled = source.settlements.some(
          (settlement) =>
            settlement.jobId === rule.jobId &&
            cursor >= settlement.periodStart &&
            cursor <= settlement.periodEnd,
        );
        const resting = source.restDays.some(
          (rest) => rest.jobId === rule.jobId && rest.date === cursor,
        );
        if (job.rule.rate <= 0) {
          // 单价为 0 时不生成工记，也不能推进游标：否则改回单价后这些天永久漏补。
          skipped += 1;
          paySkipped += 1;
        } else {
          const entry = duplicate || settled || resting
            ? null
            : entryFromRule(rule, job, cursor, timestamp, idFactory());
          if (!entry || wouldExceedDayLimit(entries, cursor, entry.hours)) {
            skipped += 1;
          } else {
            entries = [entry, ...entries];
            changed = true;
            added += 1;
            if (
              entry.hours <= 0 &&
              (job.rule.payType === 'daily' || job.rule.payType === 'monthly')
            ) {
              // 0 工时仍会按全额日薪 / 月薪计薪，单独计数让 UI 可提示。
              zeroHourEntries += 1;
            }
          }
          rule = { ...rule, lastProcessedDate: cursor };
        }
      }
      cursor = addDays(cursor, 1);
      guard += 1;
    }
    if (rule !== original) {
      rules = rules.map((item) => (item.id === rule.id ? rule : item));
      changed = true;
    }
  }

  const result = { added, skipped, truncated, zeroHourEntries, paySkipped, startDateBehindCursor };
  if (!changed) return { state: source, ...result };
  return { state: { ...source, entries, recurringRules: rules }, ...result };
}
