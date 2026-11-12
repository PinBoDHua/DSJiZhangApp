import type {
  Advance,
  AppState,
  Cycle,
  Entry,
  Job,
  JobColor,
  MonthlyMode,
  PayRule,
  PayType,
  RecurringFrequency,
  RecurringRule,
  RestDay,
  RestPolicy,
  Settlement,
  ThemeMode,
  TrashedAdvance,
  TrashedEntry,
  TrashedJob,
  TrashedRest,
  WorkTimer,
} from '../types';
import { JOB_COLORS } from './meta';
import { nowISO } from './date';
import { limitTrash, purgeExpiredTrash } from './trash';

export const STORAGE_KEY = 'xinshi.state.v7';
export const LEGACY_STORAGE_KEYS = ['xinshi.state.v6', 'xinshi.state.v5', 'xinshi.state.v4', 'xinshi.state.v3', 'xinshi.state.v2', 'xinshi.state.v1'];
export const THEME_KEY = 'xinshi.theme';
export const EXPORT_APP = 'xinshi';
/** v1.0 起冻结在 v7；新增字段只允许可选，旧备份继续可导入 */
export const SCHEMA_VERSION = 7;

export function createEmptyState(name = ''): AppState {
  return {
    version: 7,
    profile: { name, hideAmounts: false },
    settings: {
      weekStartsOn: 1,
      theme: 'system',
      reminder: { enabled: false, time: '21:00' },
    },
    jobs: [],
    trashedJobs: [],
    trashedEntries: [],
    trashedRests: [],
    trashedAdvances: [],
    entries: [],
    restDays: [],
    advances: [],
    settlements: [],
    activeTimer: null,
    onboardingDone: false,
    createdAt: nowISO(),
  };
}

export interface LoadStateFailure {
  key: string;
  raw: string;
  message: string;
  /** unavailable = 存储本身不可访问（隐私模式 / 策略拦截），不是账本损坏 */
  kind: 'unavailable' | 'invalid';
}

export interface LoadStateResult {
  state: AppState | null;
  failure: LoadStateFailure | null;
}

/** 已存在但损坏 / 高版本的数据必须停下，不能回退后覆盖原记录。 */
export function loadStateDetailed(): LoadStateResult {
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
  for (const key of keys) {
    let raw: string | null;
    try {
      raw = localStorage.getItem(key);
    } catch (error) {
      // 访问 localStorage 本身抛错（SecurityError / 存储被策略禁用）时不能当成
      // “已有账本损坏”，否则会把用户锁死在恢复页，正常使用也会被阻断。
      return {
        state: null,
        failure: {
          key,
          raw: '',
          message: error instanceof Error ? error.message : '浏览器拒绝了本地存储访问',
          kind: 'unavailable',
        },
      };
    }
    if (raw === null) continue;
    try {
      const state = validateImport(raw);
      // 只有真正发生了“旧 key → v7”迁移才回写。读取（含跨标签页 storage 事件）
      // 绝不能顺手整本回写：读-改-写没有 CAS，会把别的窗口刚保存的新状态覆盖掉。
      if (LEGACY_STORAGE_KEYS.includes(key)) {
        try {
          saveState(state);
          localStorage.removeItem(key);
        } catch (error) {
          // 已校验的账本仍可只读加载；保存失败由 Store 的持久化提示继续告知。
          console.warn('迁移本地数据失败，但已加载', error);
        }
      }
      return { state, failure: null };
    } catch (error) {
      console.error(`本地账本无法读取（${key}）`, error);
      return {
        state: null,
        failure: {
          key,
          raw,
          message: error instanceof Error ? error.message : '账本格式无法识别',
          kind: 'invalid',
        },
      };
    }
  }
  return { state: null, failure: null };
}

export function saveState(state: AppState): void {
  // 主题先写且单独兜底：账本写入才是关键路径，避免主题写失败误报「账本存储不足」。
  try {
    localStorage.setItem(THEME_KEY, state.settings.theme);
  } catch {
    // 主题写失败不影响账本保存
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearStoredState(): void {
  localStorage.removeItem(STORAGE_KEY);
  for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem('xinshi.lastBackup');
  localStorage.removeItem('xinshi.budgetAlert');
}

export function backupFileName(now = new Date(), encrypted = false): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `薪时${encrypted ? '加密' : ''}备份-${date}-${time}.json`;
}

export function buildExportPayload(state: AppState): string {
  return JSON.stringify(
    {
      app: EXPORT_APP,
      version: SCHEMA_VERSION,
      exportedAt: nowISO(),
      data: state,
    },
    null,
    2,
  );
}

export function downloadText(
  filename: string,
  text: string,
  mimeType = 'application/json;charset=utf-8',
): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ */
/* 导入校验：宁可拒绝，也不要把坏数据写进账本                           */
/* ------------------------------------------------------------------ */

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function isValidDate(value: unknown): value is string {
  const text = asString(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

function asDate(value: unknown): string {
  const text = asString(value);
  if (!isValidDate(text)) throw new Error('存在无效日期，无法导入');
  return text;
}

function asTime(value: unknown): string | undefined {
  const text = asString(value);
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : undefined;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function requireObject(value: unknown, label: string): Raw {
  if (!isRecord(value)) throw new Error(`${label}格式不正确`);
  return value;
}

const PAY_TYPES: PayType[] = ['hourly', 'daily', 'monthly', 'piece'];
const MONTHLY_MODES: MonthlyMode[] = ['prorated', 'fixed'];
const REST_POLICIES: RestPolicy[] = ['quota', 'flexible'];
const CYCLES: Cycle[] = ['daily', 'weekly', 'monthly'];
const COLORS: JobColor[] = JOB_COLORS.map((color) => color.key);
const THEMES: ThemeMode[] = ['system', 'light', 'dark'];
const RECURRING_FREQUENCIES: RecurringFrequency[] = ['daily', 'weekly', 'monthly'];

function normalizeReminder(value: unknown): { enabled: boolean; time: string } {
  const raw = isRecord(value) ? value : {};
  const time = asString(raw.time, '21:00');
  return {
    enabled: asBoolean(raw.enabled),
    time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '21:00',
  };
}

function normalizeTimer(value: unknown, jobs: Map<string, Job>): WorkTimer | null {
  if (!isRecord(value)) return null;
  const jobId = asString(value.jobId);
  const startedAt = asString(value.startedAt);
  const job = jobs.get(jobId);
  if (!job || job.archived || job.rule.payType === 'piece') return null;
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) return null;
  return { jobId, startedAt };
}

function normalizeRule(value: unknown, fallback?: PayRule): PayRule {
  if (!isRecord(value) && !fallback) throw new Error('计薪规则缺失');
  const raw = isRecord(value) ? value : {};
  const base = fallback;
  const payType = pick(raw.payType, PAY_TYPES, base?.payType ?? 'hourly');
  const rate = Math.max(0, asNumber(raw.rate, base?.rate ?? 0));
  const standardHours = Math.max(0.5, asNumber(raw.standardHours, base?.standardHours ?? 8));
  const expectedDays = Math.max(1, asNumber(raw.expectedDays, base?.expectedDays ?? 22));
  const monthlyMode = pick(raw.monthlyMode, MONTHLY_MODES, base?.monthlyMode ?? 'prorated');
  const restDaysPerMonth = Math.max(
    0,
    Math.min(31, Math.round(asNumber(raw.restDaysPerMonth, base?.restDaysPerMonth ?? 0))),
  );
  const restPolicy = pick(
    raw.restPolicy,
    REST_POLICIES,
    base?.restPolicy ?? 'quota',
  );
  const overRestDeduct = asBoolean(raw.overRestDeduct, base?.overRestDeduct ?? false);
  const overRestDailyRate = Math.max(
    0,
    asNumber(raw.overRestDailyRate, base?.overRestDailyRate ?? 0),
  );
  const unitLabelRaw = asString(raw.unitLabel, base?.unitLabel ?? '件').trim();
  const unitLabel = (unitLabelRaw || '件').slice(0, 8);
  const weekdayOT = Math.max(1, asNumber(raw.weekdayOT, base?.weekdayOT ?? 1.5));
  const weekendOT = Math.max(1, asNumber(raw.weekendOT, base?.weekendOT ?? 2));
  const holidayOT = Math.max(1, asNumber(raw.holidayOT, base?.holidayOT ?? 3));
  return {
    payType,
    rate,
    standardHours,
    expectedDays,
    monthlyMode,
    restDaysPerMonth,
    restPolicy,
    overRestDeduct,
    overRestDailyRate,
    unitLabel,
    otEnabled: asBoolean(raw.otEnabled, base?.otEnabled ?? false),
    weekdayOT,
    weekendOT,
    holidayOT,
  };
}

function normalizeShift(value: unknown): Job['shift'] {
  const raw = isRecord(value) ? value : {};
  const startTime = asTime(raw.startTime) ?? '08:00';
  const endTime = asTime(raw.endTime) ?? '17:00';
  const breakMinutes = Math.max(
    0,
    Math.min(720, Math.round(asNumber(raw.breakMinutes, 60))),
  );
  return {
    startTime: startTime === endTime ? '08:00' : startTime,
    endTime: endTime === startTime ? '17:00' : endTime,
    breakMinutes,
  };
}

function normalizeJob(value: unknown): Job {
  const raw = requireObject(value, '工作数据');
  const id = asString(raw.id);
  const name = asString(raw.name).trim();
  if (!id) throw new Error('工作数据缺少 ID');
  if (!name) throw new Error('存在没有名称的工作');
  const weekdays = Array.isArray(raw.workWeekdays)
    ? Array.from(
        new Set(
          raw.workWeekdays
            .map((item) => Math.round(asNumber(item, -1)))
            .filter((item) => item >= 0 && item <= 6),
        ),
      ).sort((a, b) => a - b)
    : [];
  return {
    id,
    name,
    employer: asString(raw.employer) || undefined,
    color: pick(raw.color, COLORS, 'pine'),
    rule: normalizeRule(raw.rule),
    shift: normalizeShift(raw.shift),
    cycle: pick(raw.cycle, CYCLES, 'weekly'),
    archived: asBoolean(raw.archived),
    workWeekdays: weekdays.length > 0 && weekdays.length < 7 ? weekdays : undefined,
    payday:
      raw.payday === undefined
        ? undefined
        : Math.max(1, Math.min(31, Math.round(asNumber(raw.payday, 1)))),
    createdAt: asString(raw.createdAt, nowISO()),
  };
}

function normalizeTrashedJob(value: unknown, now: string): TrashedJob {
  const raw = requireObject(value, '回收站工作');
  return {
    job: normalizeJob(raw.job),
    deletedAt: asString(raw.deletedAt, now),
  };
}

function normalizeEntry(value: unknown, jobs: Map<string, Job>, now: string): Entry {
  const raw = requireObject(value, '工记数据');
  const id = asString(raw.id);
  const jobId = asString(raw.jobId);
  if (!id) throw new Error('工记数据缺少 ID');
  const job = jobs.get(jobId);
  if (!job) throw new Error('工记引用了不存在的工作');
  const createdAt = asString(raw.createdAt, now);
  // 与录入 / 周期记工同一组上限：手改或第三方生成的备份不能把 1000 小时记进账本。
  const clamp = (input: unknown, max: number) =>
    Math.min(max, Math.max(0, asNumber(input)));
  return {
    id,
    jobId,
    date: asDate(raw.date),
    startTime: asTime(raw.startTime),
    endTime: asTime(raw.endTime),
    breakMinutes: Math.round(Math.min(1440, Math.max(0, asNumber(raw.breakMinutes)))),
    hours: clamp(raw.hours, 24),
    quantity: clamp(raw.quantity, 1_000_000),
    otHours: clamp(raw.otHours, 24),
    bonus: clamp(raw.bonus, 1_000_000),
    deduction: clamp(raw.deduction, 1_000_000),
    holiday: asBoolean(raw.holiday),
    note: asString(raw.note) || undefined,
    photoId: asString(raw.photoId).trim() || undefined,
    recurringRuleId: asString(raw.recurringRuleId).trim() || undefined,
    rule: normalizeRule(raw.rule, job.rule),
    settlementId: asString(raw.settlementId) || undefined,
    createdAt,
    updatedAt: asString(raw.updatedAt, createdAt),
  };
}

function normalizeAdvance(value: unknown, jobs: Map<string, Job>, now: string): Advance {
  const raw = requireObject(value, '借支数据');
  const id = asString(raw.id);
  const jobId = asString(raw.jobId);
  if (!id) throw new Error('借支数据缺少 ID');
  if (!jobs.has(jobId)) throw new Error('借支引用了不存在的工作');
  return {
    id,
    jobId,
    date: asDate(raw.date),
    amount: Math.max(0, asNumber(raw.amount)),
    note: asString(raw.note) || undefined,
    settlementId: asString(raw.settlementId) || undefined,
    createdAt: asString(raw.createdAt, now),
  };
}

function normalizeRestDay(value: unknown, jobs: Map<string, Job>, now: string): RestDay {
  const raw = requireObject(value, '休息日数据');
  const id = asString(raw.id);
  const jobId = asString(raw.jobId);
  if (!id) throw new Error('休息日数据缺少 ID');
  if (!jobs.has(jobId)) throw new Error('休息日引用了不存在的工作');
  return {
    id,
    jobId,
    date: asDate(raw.date),
    days: raw.days === 0.5 ? 0.5 : 1,
    note: asString(raw.note) || undefined,
    createdAt: asString(raw.createdAt, now),
  };
}

/* 回收站副本：坏掉的单条直接跳过，不因为一条旧记录拒绝整份备份 */
function normalizeTrashedEntry(
  value: unknown,
  jobs: Map<string, Job>,
  now: string,
): TrashedEntry | null {
  const raw = isRecord(value) ? value : null;
  const entryRaw = raw && isRecord(raw.entry) ? raw.entry : null;
  if (!raw || !entryRaw) return null;
  if (!jobs.has(asString(entryRaw.jobId))) return null;
  try {
    return {
      entry: normalizeEntry(entryRaw, jobs, now),
      deletedAt: asString(raw.deletedAt, now),
    };
  } catch {
    return null;
  }
}

function normalizeTrashedRest(
  value: unknown,
  jobs: Map<string, Job>,
  now: string,
): TrashedRest | null {
  const raw = isRecord(value) ? value : null;
  const restRaw = raw && isRecord(raw.restDay) ? raw.restDay : null;
  if (!raw || !restRaw) return null;
  if (!jobs.has(asString(restRaw.jobId))) return null;
  try {
    return {
      restDay: normalizeRestDay(restRaw, jobs, now),
      deletedAt: asString(raw.deletedAt, now),
    };
  } catch {
    return null;
  }
}

function normalizeTrashedAdvance(
  value: unknown,
  jobs: Map<string, Job>,
  now: string,
): TrashedAdvance | null {
  const raw = isRecord(value) ? value : null;
  const advanceRaw = raw && isRecord(raw.advance) ? raw.advance : null;
  if (!raw || !advanceRaw) return null;
  if (!jobs.has(asString(advanceRaw.jobId))) return null;
  try {
    return {
      advance: normalizeAdvance(advanceRaw, jobs, now),
      deletedAt: asString(raw.deletedAt, now),
    };
  } catch {
    return null;
  }
}

function normalizeSettlement(value: unknown, jobs: Map<string, Job>, now: string): Settlement {
  const raw = requireObject(value, '结算数据');
  const id = asString(raw.id);
  const jobId = asString(raw.jobId);
  if (!id) throw new Error('结算数据缺少 ID');
  const job = jobs.get(jobId);
  if (!job) throw new Error('结算引用了不存在的工作');
  const net = asNumber(raw.net);
  const paidAmount = Math.max(0, asNumber(raw.paidAmount));
  const periodStart = asDate(raw.periodStart);
  const periodEnd = asDate(raw.periodEnd);
  if (periodStart > periodEnd) throw new Error('结算开始日期不能晚于结束日期，无法导入');
  const restDates = Array.isArray(raw.restDates)
    ? Array.from(
        new Set(
          raw.restDates
            .map((item) => asString(item))
            .filter(isValidDate),
        ),
      ).sort()
    : undefined;
  const paymentStatus = raw.paymentStatus
    ? pick(raw.paymentStatus, ['unpaid', 'partial', 'paid'] as const, 'unpaid')
    : paidAmount <= 0
      ? 'unpaid'
      : paidAmount >= net
        ? 'paid'
        : 'partial';
  return {
    id,
    jobId,
    jobName: asString(raw.jobName, job.name),
    cycle: pick(raw.cycle, CYCLES, job.cycle),
    periodStart,
    periodEnd,
    payType: raw.payType ? pick(raw.payType, PAY_TYPES, job.rule.payType) : undefined,
    monthlyMode: raw.monthlyMode
      ? pick(raw.monthlyMode, MONTHLY_MODES, job.rule.monthlyMode)
      : undefined,
    quantity: raw.quantity === undefined ? undefined : Math.max(0, asNumber(raw.quantity)),
    unitLabel: raw.unitLabel ? asString(raw.unitLabel) : undefined,
    restDays: raw.restDays === undefined ? undefined : Math.max(0, asNumber(raw.restDays)),
    restDates,
    base: asNumber(raw.base),
    otPay: asNumber(raw.otPay),
    bonus: asNumber(raw.bonus),
    deduction: asNumber(raw.deduction),
    overRestDays:
      raw.overRestDays === undefined ? undefined : Math.max(0, asNumber(raw.overRestDays)),
    overRestDeduction:
      raw.overRestDeduction === undefined
        ? undefined
        : Math.max(0, asNumber(raw.overRestDeduction)),
    advanceTotal: asNumber(raw.advanceTotal),
    extraBonus: asNumber(raw.extraBonus),
    extraDeduction: asNumber(raw.extraDeduction),
    net,
    hours: asNumber(raw.hours),
    days: asNumber(raw.days),
    otHours: asNumber(raw.otHours),
    entryIds: Array.isArray(raw.entryIds) ? raw.entryIds.map(String) : [],
    advanceIds: Array.isArray(raw.advanceIds) ? raw.advanceIds.map(String) : [],
    note: asString(raw.note) || undefined,
    createdAt: asString(raw.createdAt, now),
    paymentStatus,
    paidAmount,
    paidAt: raw.paidAt ? asDate(raw.paidAt) : undefined,
    paymentMethod: asString(raw.paymentMethod) || undefined,
    paymentNote: asString(raw.paymentNote) || undefined,
  };
}

function normalizeRecurringRule(
  value: unknown,
  jobs: Map<string, Job>,
  now: string,
): RecurringRule {
  const raw = requireObject(value, '周期记工规则');
  const id = asString(raw.id).trim();
  const jobId = asString(raw.jobId);
  if (!id) throw new Error('周期记工规则缺少 ID');
  if (!jobs.has(jobId)) throw new Error('周期记工规则引用了不存在的工作');
  const frequency = pick(raw.frequency, RECURRING_FREQUENCIES, 'weekly');
  const weekdays = Array.isArray(raw.weekdays)
    ? Array.from(
        new Set(
          raw.weekdays
            .map((item) => Math.round(asNumber(item, -1)))
            .filter((item) => item >= 0 && item <= 6),
        ),
      ).sort((a, b) => a - b)
    : [];
  if (frequency === 'weekly' && weekdays.length === 0) {
    throw new Error('每周记工规则至少需要一个工作日');
  }
  const startDate = asDate(raw.startDate);
  const endDate = raw.endDate ? asDate(raw.endDate) : undefined;
  if (endDate && endDate < startDate) throw new Error('周期记工结束日期早于开始日期');
  const createdAt = asString(raw.createdAt, now);
  return {
    id,
    jobId,
    frequency,
    weekdays,
    dayOfMonth: Math.max(1, Math.min(31, Math.round(asNumber(raw.dayOfMonth, 1)))),
    startDate,
    endDate,
    hours: Math.max(0, Math.min(24, asNumber(raw.hours))),
    quantity: Math.max(0, Math.min(1_000_000, asNumber(raw.quantity))),
    bonus: Math.max(0, asNumber(raw.bonus)),
    deduction: Math.max(0, asNumber(raw.deduction)),
    note: asString(raw.note).trim().slice(0, 80) || undefined,
    enabled: asBoolean(raw.enabled, true),
    auto: asBoolean(raw.auto, true),
    lastProcessedDate: isValidDate(raw.lastProcessedDate)
      ? raw.lastProcessedDate
      : undefined,
    createdAt,
    updatedAt: asString(raw.updatedAt, createdAt),
  };
}

export interface ValidateImportOptions {
  /** 用户主动导入备份时解锁指向不存在结算的工记 / 借支；本机读取保留给账本体检处理 */
  unlockOrphans?: boolean;
}

export function validateImport(
  text: string,
  options: ValidateImportOptions = {},
): AppState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON，无法导入');
  }
  const wrapper = isRecord(parsed) ? parsed : null;
  if (wrapper && 'app' in wrapper && wrapper.app !== EXPORT_APP) {
    throw new Error('这不是薪时的备份文件');
  }
  if (wrapper && typeof wrapper.version === 'number' && wrapper.version > 7) {
    throw new Error('备份来自更新版本的薪时，请升级后再导入');
  }
  const raw = wrapper && isRecord(wrapper.data) ? wrapper.data : parsed;
  if (!isRecord(raw)) throw new Error('备份内容格式不正确');

  const now = nowISO();
  const jobsRaw = raw.jobs;
  const entriesRaw = raw.entries;
  const advancesRaw = raw.advances;
  const settlementsRaw = raw.settlements;
  if (!Array.isArray(jobsRaw) || !Array.isArray(entriesRaw)) {
    throw new Error('备份缺少工作或工记数据');
  }

  const jobs = jobsRaw.map(normalizeJob);
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  if (jobMap.size !== jobs.length) throw new Error('工作数据存在重复 ID');

  const trashedIds = new Set<string>();
  const trashedJobs: TrashedJob[] = [];
  for (const item of Array.isArray(raw.trashedJobs) ? raw.trashedJobs : []) {
    let trashed: TrashedJob;
    try {
      trashed = normalizeTrashedJob(item, now);
    } catch {
      // 单条回收站工作坏掉就跳过，不拒绝整份备份
      continue;
    }
    if (jobMap.has(trashed.job.id) || trashedIds.has(trashed.job.id)) continue;
    trashedIds.add(trashed.job.id);
    trashedJobs.push(trashed);
  }
  const activeTrash = limitTrash(purgeExpiredTrash(trashedJobs));

  // 回收站里的工记 / 休息 / 借支可能指向已删除的工作，所以合并两份工作表校验。
  const knownJobs = new Map(jobMap);
  for (const item of activeTrash) knownJobs.set(item.job.id, item.job);

  const entryIds = new Set<string>();
  const entries: Entry[] = [];
  for (const item of entriesRaw) {
    const entry = normalizeEntry(item, jobMap, now);
    if (entryIds.has(entry.id)) throw new Error('工记数据存在重复 ID');
    entryIds.add(entry.id);
    entries.push(entry);
  }

  const restDaysRaw = raw.restDays;
  const restDayIds = new Set<string>();
  const restDayKeys = new Set<string>();
  const restDays: RestDay[] = [];
  for (const item of Array.isArray(restDaysRaw) ? restDaysRaw : []) {
    const restDay = normalizeRestDay(item, jobMap, now);
    // 删除 / 恢复都按 id 操作：重复 id 会让取消一天休息时连带删掉另一天。
    if (restDayIds.has(restDay.id)) throw new Error('休息日数据存在重复 ID');
    restDayIds.add(restDay.id);
    const key = `${restDay.jobId}|${restDay.date}`;
    if (restDayKeys.has(key)) continue;
    restDayKeys.add(key);
    restDays.push(restDay);
  }

  const advanceIds = new Set<string>();
  const advances: Advance[] = [];
  for (const item of Array.isArray(advancesRaw) ? advancesRaw : []) {
    const advance = normalizeAdvance(item, jobMap, now);
    if (advanceIds.has(advance.id)) throw new Error('借支数据存在重复 ID');
    advanceIds.add(advance.id);
    advances.push(advance);
  }

  const settlementIds = new Set<string>();
  const settlementsByJob = new Map<string, Settlement[]>();
  const settlements: Settlement[] = [];
  for (const item of Array.isArray(settlementsRaw) ? settlementsRaw : []) {
    const settlement = normalizeSettlement(item, jobMap, now);
    if (settlementIds.has(settlement.id)) throw new Error('结算数据存在重复 ID');
    const siblings = settlementsByJob.get(settlement.jobId) ?? [];
    if (
      siblings.some(
        (existing) =>
          existing.periodStart <= settlement.periodEnd &&
          settlement.periodStart <= existing.periodEnd,
      )
    ) {
      throw new Error('同一工作的结算周期重叠，无法导入');
    }
    siblings.push(settlement);
    settlementsByJob.set(settlement.jobId, siblings);
    settlementIds.add(settlement.id);
    settlements.push(settlement);
  }

  const recurringRuleIds = new Set<string>();
  const recurringRules: RecurringRule[] = [];
  for (const item of Array.isArray(raw.recurringRules) ? raw.recurringRules : []) {
    const rule = normalizeRecurringRule(item, jobMap, now);
    if (recurringRuleIds.has(rule.id)) throw new Error('周期记工规则存在重复 ID');
    recurringRuleIds.add(rule.id);
    recurringRules.push(rule);
  }

  const settlementMap = new Map(settlements.map((settlement) => [settlement.id, settlement]));
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const advanceMap = new Map(advances.map((advance) => [advance.id, advance]));
  const assertLinkedRecord = (
    record: Entry | Advance,
    settlement: Settlement,
    label: '工记' | '借支',
  ) => {
    if (record.jobId !== settlement.jobId) {
      throw new Error(`${label}与结算单所属工作不一致，无法导入`);
    }
    const outsidePeriod =
      label === '借支'
        ? record.date > settlement.periodEnd
        : record.date < settlement.periodStart || record.date > settlement.periodEnd;
    if (outsidePeriod) {
      throw new Error(`${label}日期超出结算周期，无法导入`);
    }
    const referencedIds = label === '工记' ? settlement.entryIds : settlement.advanceIds;
    if (!referencedIds.includes(record.id)) {
      throw new Error(`结算单未列出已锁定的${label}，引用不一致，无法导入`);
    }
  };

  // 已存在的结算必须与记录互相引用，且岗位、日期一致；只有不存在的结算才走孤儿修复。
  for (const entry of entries) {
    const settlement = entry.settlementId ? settlementMap.get(entry.settlementId) : undefined;
    if (settlement) assertLinkedRecord(entry, settlement, '工记');
  }
  for (const advance of advances) {
    const settlement = advance.settlementId
      ? settlementMap.get(advance.settlementId)
      : undefined;
    if (settlement) assertLinkedRecord(advance, settlement, '借支');
  }
  for (const settlement of settlements) {
    for (const id of settlement.entryIds) {
      const entry = entryMap.get(id);
      if (!entry) throw new Error('结算单引用了不存在的工记，无法导入');
      if (entry.settlementId !== settlement.id) {
        throw new Error('结算单与工记存在单向引用，无法导入');
      }
      assertLinkedRecord(entry, settlement, '工记');
    }
    for (const id of settlement.advanceIds) {
      const advance = advanceMap.get(id);
      if (!advance) throw new Error('结算单引用了不存在的借支，无法导入');
      if (advance.settlementId !== settlement.id) {
        throw new Error('结算单与借支存在单向引用，无法导入');
      }
      assertLinkedRecord(advance, settlement, '借支');
    }
  }

  // 结算单被删掉后留下的锁定引用：主动导入时解锁，本机读取保留给账本体检处理
  const repairedEntries = options.unlockOrphans
    ? entries.map((entry) =>
        entry.settlementId && !settlementIds.has(entry.settlementId)
          ? { ...entry, settlementId: undefined }
          : entry,
      )
    : entries;
  const repairedAdvances = options.unlockOrphans
    ? advances.map((advance) =>
        advance.settlementId && !settlementIds.has(advance.settlementId)
          ? { ...advance, settlementId: undefined }
          : advance,
      )
    : advances;

  const trashedEntryIds = new Set<string>();
  const trashedEntries: TrashedEntry[] = [];
  for (const item of Array.isArray(raw.trashedEntries) ? raw.trashedEntries : []) {
    const trashed = normalizeTrashedEntry(item, knownJobs, now);
    if (!trashed || trashedEntryIds.has(trashed.entry.id)) continue;
    trashedEntryIds.add(trashed.entry.id);
    trashedEntries.push(trashed);
  }

  const trashedRestIds = new Set<string>();
  const trashedRestKeys = new Set<string>();
  const trashedRests: TrashedRest[] = [];
  for (const item of Array.isArray(raw.trashedRests) ? raw.trashedRests : []) {
    const trashed = normalizeTrashedRest(item, knownJobs, now);
    if (!trashed) continue;
    const key = `${trashed.restDay.jobId}|${trashed.restDay.date}`;
    if (trashedRestIds.has(trashed.restDay.id) || trashedRestKeys.has(key)) continue;
    trashedRestIds.add(trashed.restDay.id);
    trashedRestKeys.add(key);
    trashedRests.push(trashed);
  }

  const trashedAdvanceIds = new Set<string>();
  const trashedAdvances: TrashedAdvance[] = [];
  for (const item of Array.isArray(raw.trashedAdvances) ? raw.trashedAdvances : []) {
    const trashed = normalizeTrashedAdvance(item, knownJobs, now);
    if (!trashed || trashedAdvanceIds.has(trashed.advance.id)) continue;
    trashedAdvanceIds.add(trashed.advance.id);
    trashedAdvances.push(trashed);
  }

  const profileRaw = isRecord(raw.profile) ? raw.profile : {};
  const settingsRaw = isRecord(raw.settings) ? raw.settings : {};
  const weekStartsOn = asNumber(settingsRaw.weekStartsOn, 1) === 0 ? 0 : 1;
  const theme = pick(settingsRaw.theme, THEMES, 'system');
  const reminder = normalizeReminder(settingsRaw.reminder);
  const budgetRaw = isRecord(settingsRaw.budget) ? settingsRaw.budget : null;
  const budget = budgetRaw
    ? {
        enabled: asBoolean(budgetRaw.enabled),
        incomeTarget: Math.max(0, Math.min(100_000_000, asNumber(budgetRaw.incomeTarget))),
        hoursLimit: Math.max(0, Math.min(744, asNumber(budgetRaw.hoursLimit))),
      }
    : undefined;
  const activeTimer = normalizeTimer(raw.activeTimer, jobMap);

  return {
    version: 7,
    profile: {
      name: asString(profileRaw.name),
      hideAmounts: asBoolean(profileRaw.hideAmounts),
    },
    settings: { weekStartsOn, theme, reminder, ...(budget ? { budget } : {}) },
    jobs,
    trashedJobs: activeTrash,
    trashedEntries: limitTrash(purgeExpiredTrash(trashedEntries)),
    trashedRests: limitTrash(purgeExpiredTrash(trashedRests)),
    trashedAdvances: limitTrash(purgeExpiredTrash(trashedAdvances)),
    entries: repairedEntries,
    restDays,
    advances: repairedAdvances,
    settlements,
    ...(recurringRules.length > 0 ? { recurringRules } : {}),
    activeTimer,
    onboardingDone: asBoolean(raw.onboardingDone, jobs.length > 0),
    createdAt: asString(raw.createdAt, now),
  };
}
