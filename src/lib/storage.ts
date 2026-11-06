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

export function loadState(): AppState | null {
  const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const state = validateImport(raw);
      try {
        saveState(state);
        if (LEGACY_STORAGE_KEYS.includes(key)) localStorage.removeItem(key);
      } catch (error) {
        console.warn('迁移本地数据失败，但已加载', error);
      }
      return state;
    } catch (error) {
      console.warn(`读取本地数据失败（${key}）`, error);
    }
  }
  return null;
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.setItem(THEME_KEY, state.settings.theme);
}

export function clearStoredState(): void {
  localStorage.removeItem(STORAGE_KEY);
  for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem('xinshi.lastBackup');
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

function asDate(value: unknown): string {
  const text = asString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('存在无效日期，无法导入');
  return text;
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
  const startTime = /^\d{2}:\d{2}$/.test(asString(raw.startTime))
    ? asString(raw.startTime)
    : '08:00';
  const endTime = /^\d{2}:\d{2}$/.test(asString(raw.endTime))
    ? asString(raw.endTime)
    : '17:00';
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
  return {
    id,
    jobId,
    date: asDate(raw.date),
    startTime: asString(raw.startTime) || undefined,
    endTime: asString(raw.endTime) || undefined,
    breakMinutes: Math.max(0, asNumber(raw.breakMinutes)),
    hours: Math.max(0, asNumber(raw.hours)),
    quantity: Math.max(0, asNumber(raw.quantity)),
    otHours: Math.max(0, asNumber(raw.otHours)),
    bonus: Math.max(0, asNumber(raw.bonus)),
    deduction: Math.max(0, asNumber(raw.deduction)),
    holiday: asBoolean(raw.holiday),
    note: asString(raw.note) || undefined,
    photoId: asString(raw.photoId).trim() || undefined,
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
  const restDates = Array.isArray(raw.restDates)
    ? Array.from(
        new Set(
          raw.restDates
            .map((item) => asString(item))
            .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item)),
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
    periodStart: asDate(raw.periodStart),
    periodEnd: asDate(raw.periodEnd),
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
  const restDayKeys = new Set<string>();
  const restDays: RestDay[] = [];
  for (const item of Array.isArray(restDaysRaw) ? restDaysRaw : []) {
    const restDay = normalizeRestDay(item, jobMap, now);
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
  const activeTimer = normalizeTimer(raw.activeTimer, jobMap);

  return {
    version: 7,
    profile: {
      name: asString(profileRaw.name),
      hideAmounts: asBoolean(profileRaw.hideAmounts),
    },
    settings: { weekStartsOn, theme, reminder },
    jobs,
    trashedJobs: activeTrash,
    trashedEntries: limitTrash(purgeExpiredTrash(trashedEntries)),
    trashedRests: limitTrash(purgeExpiredTrash(trashedRests)),
    trashedAdvances: limitTrash(purgeExpiredTrash(trashedAdvances)),
    entries: repairedEntries,
    restDays,
    advances: repairedAdvances,
    settlements,
    activeTimer,
    onboardingDone: asBoolean(raw.onboardingDone, jobs.length > 0),
    createdAt: asString(raw.createdAt, now),
  };
}
