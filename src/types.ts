export type PayType = 'hourly' | 'daily' | 'monthly' | 'piece';
export type MonthlyMode = 'prorated' | 'fixed';
/** 固定月薪的休息规则：固定额度 / 随机休息 */
export type RestPolicy = 'quota' | 'flexible';
export type Cycle = 'daily' | 'weekly' | 'monthly';
export type WeekStart = 0 | 1;
export type JobColor = 'pine' | 'amber' | 'clay' | 'sky' | 'plum' | 'olive';
export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface PayRule {
  payType: PayType;
  /** 时薪 / 日薪 / 月薪 / 每件单价 */
  rate: number;
  standardHours: number;
  /** 月计薪天数，仅月薪使用 */
  expectedDays: number;
  /** 月薪算法：按出勤折算 / 固定月薪 */
  monthlyMode: MonthlyMode;
  /** 固定月薪岗位的月休额度，仅用于统计和提示 */
  restDaysPerMonth: number;
  /** 固定月薪的休息规则；缺省按固定额度处理，兼容旧数据 */
  restPolicy?: RestPolicy;
  /** 固定月薪时，超出月休额度是否自动扣款 */
  overRestDeduct: boolean;
  /** 超休每天扣款；0 表示按 月薪 / 计薪天数 自动计算 */
  overRestDailyRate: number;
  /** 计件单位，例如 件 / 米 / 平方 */
  unitLabel: string;
  otEnabled: boolean;
  weekdayOT: number;
  weekendOT: number;
  holidayOT: number;
}

export interface ShiftTemplate {
  startTime: string;
  endTime: string;
  breakMinutes: number;
}

export interface Job {
  id: string;
  name: string;
  employer?: string;
  color: JobColor;
  rule: PayRule;
  /** 新建工记时默认带入的班次 */
  shift: ShiftTemplate;
  cycle: Cycle;
  archived: boolean;
  /** 固定上班日（0=周日 … 6=周六）；为空表示不固定 */
  workWeekdays?: number[];
  /** 每月发薪日 1–31，仅做提醒 */
  payday?: number;
  createdAt: string;
}

export interface TrashedJob {
  job: Job;
  deletedAt: string;
}

/** 回收站里的工记副本，超过保留期后自动清理 */
export interface TrashedEntry {
  entry: Entry;
  deletedAt: string;
}

export interface TrashedRest {
  restDay: RestDay;
  deletedAt: string;
}

export interface TrashedAdvance {
  advance: Advance;
  deletedAt: string;
}

export type TrashKind = 'job' | 'entry' | 'rest' | 'advance';

export interface RestDay {
  id: string;
  jobId: string;
  date: string;
  /** 0.5 = 半天，1 = 整天；缺省按整天处理 */
  days?: number;
  note?: string;
  createdAt: string;
}

export interface Entry {
  id: string;
  jobId: string;
  /** 上班当天，YYYY-MM-DD */
  date: string;
  startTime?: string;
  endTime?: string;
  breakMinutes: number;
  hours: number;
  /** 计件数量，仅计件工资使用 */
  quantity: number;
  otHours: number;
  bonus: number;
  deduction: number;
  holiday: boolean;
  note?: string;
  /** 记录创建时的计薪快照，后续调价不影响历史 */
  rule: PayRule;
  settlementId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Advance {
  id: string;
  jobId: string;
  date: string;
  amount: number;
  note?: string;
  settlementId?: string;
  createdAt: string;
}

export interface Settlement {
  id: string;
  jobId: string;
  jobName: string;
  cycle: Cycle;
  periodStart: string;
  periodEnd: string;
  payType?: PayType;
  monthlyMode?: MonthlyMode;
  quantity?: number;
  unitLabel?: string;
  restDays?: number;
  /** 结算时锁定的具体休息日期，旧结算可能没有 */
  restDates?: string[];
  base: number;
  otPay: number;
  bonus: number;
  deduction: number;
  overRestDays?: number;
  overRestDeduction?: number;
  advanceTotal: number;
  extraBonus: number;
  extraDeduction: number;
  net: number;
  hours: number;
  days: number;
  otHours: number;
  entryIds: string[];
  advanceIds: string[];
  note?: string;
  createdAt: string;
  paymentStatus?: PaymentStatus;
  paidAmount?: number;
  paidAt?: string;
  paymentMethod?: string;
  paymentNote?: string;
}

export interface Profile {
  name: string;
  hideAmounts: boolean;
}

export interface Settings {
  weekStartsOn: WeekStart;
  theme: ThemeMode;
  reminder: {
    enabled: boolean;
    time: string;
  };
}

export interface WorkTimer {
  jobId: string;
  /** ISO 时间戳；刷新 / 关掉页面后仍能继续计时 */
  startedAt: string;
}

export interface AppState {
  version: 7;
  profile: Profile;
  settings: Settings;
  jobs: Job[];
  trashedJobs: TrashedJob[];
  trashedEntries: TrashedEntry[];
  trashedRests: TrashedRest[];
  trashedAdvances: TrashedAdvance[];
  entries: Entry[];
  restDays: RestDay[];
  advances: Advance[];
  settlements: Settlement[];
  activeTimer: WorkTimer | null;
  onboardingDone: boolean;
  createdAt: string;
}

export interface Period {
  start: string;
  end: string;
  key: string;
  label: string;
  shortLabel: string;
}

export interface EntryPay {
  base: number;
  otPay: number;
  otHours: number;
  otRate: number;
  multiplier: number;
  bonus: number;
  deduction: number;
  total: number;
}

export interface Totals {
  base: number;
  otPay: number;
  bonus: number;
  deduction: number;
  total: number;
  hours: number;
  days: number;
  otHours: number;
  capAdjustment: number;
}

export interface SettlementDraft {
  jobId: string;
  jobName: string;
  cycle: Cycle;
  payType: PayType;
  monthlyMode: MonthlyMode;
  quantity: number;
  unitLabel: string;
  restDays: number;
  restDates: string[];
  period: Period;
  entries: Entry[];
  advances: Advance[];
  base: number;
  otPay: number;
  bonus: number;
  deduction: number;
  extraBonus: number;
  extraDeduction: number;
  overRestDays: number;
  overRestDeduction: number;
  advanceTotal: number;
  net: number;
  hours: number;
  days: number;
  otHours: number;
  capAdjustment: number;
  entryIds: string[];
  advanceIds: string[];
}
