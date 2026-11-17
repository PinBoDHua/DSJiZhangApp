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
          // 双窗口同时冷启动迁移：先再读一次主键，另一个标签页已经写好新账本就放弃回写，
          // 避免用同一份 v6 旧账覆盖对方刚保存的改动。
          if (localStorage.getItem(STORAGE_KEY) === null) {
            saveState(state);
            localStorage.removeItem(key);
          }
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

/* 导入字段上限：与录入界面 / store 侧校验保持一致，手改的备份不能把离谱数值写进账本。 */
const IMPORT_LIMITS = {
  /** 时薪 / 日薪 / 月薪 / 计件单价 */
  rate: 1_000_000,
  /** 标准工时 / 月计薪天数 / 加班倍率 */
  standardHours: 24,
  expectedDays: 31,
  otMultiplier: 10,
  /** 借支、工记奖金扣款、周期规则奖金扣款 */
  money: 1_000_000,
  /** 结算单分项与净额（允许负数方向） */
  settlementMoney: 1_000_000_000,
  /** 计件数量 */
  quantity: 1_000_000,
} as const;

/** 与界面 maxLength 对齐的字符串上限，避免数 MB 文本撑爆 localStorage。 */
const STRING_LIMITS = {
  jobName: 20,
  employer: 24,
  entryNote: 80,
  restNote: 30,
  advanceNote: 40,
  settlementNote: 60,
  profileName: 12,
  paymentNote: 60,
} as const;

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 时间戳字段：非法值回退，避免畸形 createdAt 扭曲同日多段日薪的「最新快照」排序。 */
function asTimestamp(value: unknown, fallback: string): string {
  const text = asString(value);
  return text && Number.isFinite(Date.parse(text)) ? text : fallback;
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
  const rate = clampValue(asNumber(raw.rate, base?.rate ?? 0), 0, IMPORT_LIMITS.rate);
  const standardHours = clampValue(
    asNumber(raw.standardHours, base?.standardHours ?? 8),
    0.5,
    IMPORT_LIMITS.standardHours,
  );
  const expectedDays = clampValue(
    asNumber(raw.expectedDays, base?.expectedDays ?? 22),
    1,
    IMPORT_LIMITS.expectedDays,
  );
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
  const overRestDailyRate = clampValue(
    asNumber(raw.overRestDailyRate, base?.overRestDailyRate ?? 0),
    0,
    IMPORT_LIMITS.rate,
  );
  const unitLabelRaw = asString(raw.unitLabel, base?.unitLabel ?? '件').trim();
  const unitLabel = (unitLabelRaw || '件').slice(0, 8);
  const weekdayOT = clampValue(
    asNumber(raw.weekdayOT, base?.weekdayOT ?? 1.5),
    1,
    IMPORT_LIMITS.otMultiplier,
  );
  const weekendOT = clampValue(
    asNumber(raw.weekendOT, base?.weekendOT ?? 2),
    1,
    IMPORT_LIMITS.otMultiplier,
  );
  const holidayOT = clampValue(
    asNumber(raw.holidayOT, base?.holidayOT ?? 3),
    1,
    IMPORT_LIMITS.otMultiplier,
  );
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
  const name = asString(raw.name).trim().slice(0, STRING_LIMITS.jobName);
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
    employer: asString(raw.employer).trim().slice(0, STRING_LIMITS.employer) || undefined,
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
    createdAt: asTimestamp(raw.createdAt, nowISO()),
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
  const createdAt = asTimestamp(raw.createdAt, now);
  // 与录入 / 周期记工同一组上限：手改或第三方生成的备份不能把 1000 小时记进账本。
  const hours = clampValue(asNumber(raw.hours), 0, 24);
  return {
    id,
    jobId,
    date: asDate(raw.date),
    startTime: asTime(raw.startTime),
    endTime: asTime(raw.endTime),
    breakMinutes: Math.round(Math.min(1440, Math.max(0, asNumber(raw.breakMinutes)))),
    hours,
    quantity: clampValue(asNumber(raw.quantity), 0, IMPORT_LIMITS.quantity),
    // C7 只在录入界面限制「加班时长不能大于总工时」，手改备份同样要裁到不超过总工时。
    otHours: Math.min(hours, clampValue(asNumber(raw.otHours), 0, 24)),
    bonus: clampValue(asNumber(raw.bonus), 0, IMPORT_LIMITS.money),
    deduction: clampValue(asNumber(raw.deduction), 0, IMPORT_LIMITS.money),
    holiday: asBoolean(raw.holiday),
    note: asString(raw.note).slice(0, STRING_LIMITS.entryNote) || undefined,
    photoId: asString(raw.photoId).trim() || undefined,
    recurringRuleId: asString(raw.recurringRuleId).trim() || undefined,
    rule: normalizeRule(raw.rule, job.rule),
    settlementId: asString(raw.settlementId) || undefined,
    createdAt,
    updatedAt: asTimestamp(raw.updatedAt, createdAt),
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
    amount: clampValue(asNumber(raw.amount), 0, IMPORT_LIMITS.money),
    note: asString(raw.note).slice(0, STRING_LIMITS.advanceNote) || undefined,
    settlementId: asString(raw.settlementId) || undefined,
    createdAt: asTimestamp(raw.createdAt, now),
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
    note: asString(raw.note).slice(0, STRING_LIMITS.restNote) || undefined,
    createdAt: asTimestamp(raw.createdAt, now),
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
  const net = clampValue(
    asNumber(raw.net),
    -IMPORT_LIMITS.settlementMoney,
    IMPORT_LIMITS.settlementMoney,
  );
  const paidAmount = clampValue(asNumber(raw.paidAmount), 0, IMPORT_LIMITS.settlementMoney);
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
    jobName:
      asString(raw.jobName, job.name).trim().slice(0, STRING_LIMITS.jobName) || job.name,
    cycle: pick(raw.cycle, CYCLES, job.cycle),
    periodStart,
    periodEnd,
    payType: raw.payType ? pick(raw.payType, PAY_TYPES, job.rule.payType) : undefined,
    monthlyMode: raw.monthlyMode
      ? pick(raw.monthlyMode, MONTHLY_MODES, job.rule.monthlyMode)
      : undefined,
    quantity:
      raw.quantity === undefined
        ? undefined
        : clampValue(asNumber(raw.quantity), 0, IMPORT_LIMITS.quantity),
    unitLabel: raw.unitLabel
      ? asString(raw.unitLabel).trim().slice(0, 8) || undefined
      : undefined,
    restDays:
      raw.restDays === undefined ? undefined : clampValue(asNumber(raw.restDays), 0, 31),
    restDates,
    base: clampValue(
      asNumber(raw.base),
      -IMPORT_LIMITS.settlementMoney,
      IMPORT_LIMITS.settlementMoney,
    ),
    otPay: clampValue(
      asNumber(raw.otPay),
      -IMPORT_LIMITS.settlementMoney,
      IMPORT_LIMITS.settlementMoney,
    ),
    bonus: clampValue(
      asNumber(raw.bonus),
      -IMPORT_LIMITS.settlementMoney,
      IMPORT_LIMITS.settlementMoney,
    ),
    deduction: clampValue(
      asNumber(raw.deduction),
      -IMPORT_LIMITS.settlementMoney,
      IMPORT_LIMITS.settlementMoney,
    ),
    overRestDays:
      raw.overRestDays === undefined
        ? undefined
        : clampValue(asNumber(raw.overRestDays), 0, 31),
    overRestDeduction:
      raw.overRestDeduction === undefined
        ? undefined
        : clampValue(asNumber(raw.overRestDeduction), 0, IMPORT_LIMITS.settlementMoney),
    advanceTotal: clampValue(
      asNumber(raw.advanceTotal),
      -IMPORT_LIMITS.settlementMoney,
      IMPORT_LIMITS.settlementMoney,
    ),
    extraBonus: clampValue(
      asNumber(raw.extraBonus),
      -IMPORT_LIMITS.settlementMoney,
      IMPORT_LIMITS.settlementMoney,
    ),
    extraDeduction: clampValue(
      asNumber(raw.extraDeduction),
      -IMPORT_LIMITS.settlementMoney,
      IMPORT_LIMITS.settlementMoney,
    ),
    net,
    hours: clampValue(asNumber(raw.hours), 0, IMPORT_LIMITS.quantity),
    days: clampValue(asNumber(raw.days), 0, IMPORT_LIMITS.quantity),
    otHours: clampValue(asNumber(raw.otHours), 0, IMPORT_LIMITS.quantity),
    // 同一 ID 在 entryIds 里重复出现会让体检误判「重复结算」，落库前先去重。
    entryIds: Array.isArray(raw.entryIds)
      ? Array.from(new Set(raw.entryIds.map(String)))
      : [],
    advanceIds: Array.isArray(raw.advanceIds)
      ? Array.from(new Set(raw.advanceIds.map(String)))
      : [],
    note: asString(raw.note).slice(0, STRING_LIMITS.settlementNote) || undefined,
    createdAt: asTimestamp(raw.createdAt, now),
    paymentStatus,
    paidAmount,
    paidAt: raw.paidAt ? asDate(raw.paidAt) : undefined,
    paymentMethod: asString(raw.paymentMethod).slice(0, 20) || undefined,
    paymentNote: asString(raw.paymentNote).slice(0, STRING_LIMITS.paymentNote) || undefined,
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
  const createdAt = asTimestamp(raw.createdAt, now);
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
    bonus: clampValue(asNumber(raw.bonus), 0, IMPORT_LIMITS.money),
    deduction: clampValue(asNumber(raw.deduction), 0, IMPORT_LIMITS.money),
    note: asString(raw.note).trim().slice(0, 80) || undefined,
    enabled: asBoolean(raw.enabled, true),
    auto: asBoolean(raw.auto, true),
    lastProcessedDate: isValidDate(raw.lastProcessedDate)
      ? raw.lastProcessedDate
      : undefined,
    createdAt,
    updatedAt: asTimestamp(raw.updatedAt, createdAt),
  };
}

export interface ValidateImportOptions {
  /** 用户主动导入备份时解锁指向不存在结算的工记 / 借支；本机读取保留给账本体检处理 */
  unlockOrphans?: boolean;
  /**
   * 主动导入备份时拒绝「日期落在已结算周期内、但自身没有锁定」的工记：
   * 这类记录会计入未结合计，却因周期重叠永远无法再结算。本机读取与快照恢复不开，
   * 交给账本体检提示，避免一次历史数据不一致就把用户锁死在恢复页。
   */
  rejectUnsettledInPeriod?: boolean;
  /** 非阻断的规范化提示（重复照片引用剥离等），调用方可用于 toast */
  onWarning?: (message: string) => void;
}

/** schema 版本统一按整数校验：字符串 "8" 或裸 state 的 version 都不能绕过高版本拒绝。 */
function assertSchemaVersion(value: unknown, label: string): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(label + '格式不正确，无法导入');
  }
  if (value > SCHEMA_VERSION) throw new Error('备份来自更新版本的薪时，请升级后再导入');
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
  if (wrapper && wrapper.version !== undefined) {
    assertSchemaVersion(wrapper.version, '备份版本号');
  }
  const raw = wrapper && isRecord(wrapper.data) ? wrapper.data : parsed;
  if (!isRecord(raw)) throw new Error('备份内容格式不正确');
  // 裸 state 备份没有外层版本号，同样不能放行更高 schema，否则未知字段会被静默丢弃。
  assertSchemaVersion(raw.version, '备份数据版本号');

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
  // 照片不可再生：两条工记共用一个 photoId 时，删一条会连带删掉另一条的照片。
  // 这里保留第一条、剥离后续重复引用并给出提示，不阻断整份备份的恢复。
  const photoIds = new Set<string>();
  const stripSharedPhoto = (entry: Entry, label: string): Entry => {
    if (!entry.photoId) return entry;
    if (!photoIds.has(entry.photoId)) {
      photoIds.add(entry.photoId);
      return entry;
    }
    options.onWarning?.(
      label + '「' + entry.id + '」与前面的工记共用同一张照片，已移除重复的照片引用',
    );
    return { ...entry, photoId: undefined };
  };
  for (const item of entriesRaw) {
    const entry = normalizeEntry(item, jobMap, now);
    if (entryIds.has(entry.id)) throw new Error('工记数据存在重复 ID');
    entryIds.add(entry.id);
    entries.push(stripSharedPhoto(entry, '工记'));
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

  // 主动导入时拒绝「日期落在已结算周期内却没锁定」的工记：它会计入未结合计，
  // 又因周期重叠永远无法结算，属于导入后无法自愈的状态（本机读取交给体检提示）。
  if (options.rejectUnsettledInPeriod) {
    const covered = entries.find((entry) => {
      if (entry.settlementId) return false;
      const siblings = settlementsByJob.get(entry.jobId) ?? [];
      return siblings.some(
        (settlement) =>
          entry.date >= settlement.periodStart && entry.date <= settlement.periodEnd,
      );
    });
    if (covered) {
      throw new Error(
        '工记「' + covered.id + '」的日期落在已结算周期内但没有锁定，导入后将永远无法结算',
      );
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
    if (!trashed) continue;
    // active 与回收站跨集合重复 ID：恢复路径虽然幂等，但彻底删除会按回收站条目删照片，
    // 与 trashedJobs 同口径跳过，避免同一 ID 同时出现在两个集合里。
    if (trashedEntryIds.has(trashed.entry.id) || entryIds.has(trashed.entry.id)) continue;
    trashedEntryIds.add(trashed.entry.id);
    trashed.entry = stripSharedPhoto(trashed.entry, '回收站工记');
    trashedEntries.push(trashed);
  }

  const trashedRestIds = new Set<string>();
  const trashedRestKeys = new Set<string>();
  const trashedRests: TrashedRest[] = [];
  for (const item of Array.isArray(raw.trashedRests) ? raw.trashedRests : []) {
    const trashed = normalizeTrashedRest(item, knownJobs, now);
    if (!trashed) continue;
    const key = `${trashed.restDay.jobId}|${trashed.restDay.date}`;
    if (
      trashedRestIds.has(trashed.restDay.id) ||
      restDayIds.has(trashed.restDay.id) ||
      trashedRestKeys.has(key)
    ) {
      continue;
    }
    trashedRestIds.add(trashed.restDay.id);
    trashedRestKeys.add(key);
    trashedRests.push(trashed);
  }

  const trashedAdvanceIds = new Set<string>();
  const trashedAdvances: TrashedAdvance[] = [];
  for (const item of Array.isArray(raw.trashedAdvances) ? raw.trashedAdvances : []) {
    const trashed = normalizeTrashedAdvance(item, knownJobs, now);
    if (!trashed) continue;
    if (trashedAdvanceIds.has(trashed.advance.id) || advanceIds.has(trashed.advance.id)) {
      continue;
    }
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
      name: asString(profileRaw.name).trim().slice(0, STRING_LIMITS.profileName),
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
    createdAt: asTimestamp(raw.createdAt, now),
  };
}
