export type PayType = 'hourly' | 'daily' | 'monthly' | 'piece';
export type MonthlyMode = 'prorated' | 'fixed';
export type Cycle = 'daily' | 'weekly' | 'monthly';
export type WeekStart = 0 | 1;
export type JobColor = 'pine' | 'amber' | 'clay' | 'sky' | 'plum' | 'olive';
export type ToastTone = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}
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
  createdAt: string;
}

export interface RestDay {
  id: string;
  jobId: string;
  date: string;
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
  base: number;
  otPay: number;
  bonus: number;
  deduction: number;
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
  version: 4;
  profile: Profile;
  settings: Settings;
  jobs: Job[];
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
  period: Period;
  entries: Entry[];
  advances: Advance[];
  base: number;
  otPay: number;
  bonus: number;
  deduction: number;
  extraBonus: number;
  extraDeduction: number;
  advanceTotal: number;
  net: number;
  hours: number;
  days: number;
  otHours: number;
  capAdjustment: number;
  entryIds: string[];
  advanceIds: string[];
}
