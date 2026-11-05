import type { Advance, AppState, Entry, Job, PayRule, RestDay, Settlement } from '../types';
import { createEmptyState } from './storage';

export const baseRule: PayRule = {
  payType: 'hourly',
  rate: 25,
  standardHours: 8,
  expectedDays: 22,
  monthlyMode: 'prorated',
  restDaysPerMonth: 0,
  restPolicy: 'quota',
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: true,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
};

export function makeJob(patch: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    name: '测试工作',
    color: 'pine',
    rule: { ...baseRule },
    shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
    cycle: 'weekly',
    archived: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    ...patch,
  };
}

export function makeEntry(patch: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    jobId: 'job-1',
    date: '2026-11-02',
    startTime: '08:00',
    endTime: '17:00',
    breakMinutes: 60,
    hours: 8,
    quantity: 0,
    otHours: 0,
    bonus: 0,
    deduction: 0,
    holiday: false,
    rule: { ...baseRule },
    createdAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    ...patch,
  };
}

export function makeSettlement(patch: Partial<Settlement> = {}): Settlement {
  const base = patch.base ?? 200;
  const otPay = patch.otPay ?? 0;
  const bonus = patch.bonus ?? 0;
  const deduction = patch.deduction ?? 0;
  const overRestDeduction = patch.overRestDeduction ?? 0;
  const advanceTotal = patch.advanceTotal ?? 0;
  const extraBonus = patch.extraBonus ?? 0;
  const extraDeduction = patch.extraDeduction ?? 0;
  return {
    id: 'settlement-1',
    jobId: 'job-1',
    jobName: '测试工作',
    cycle: 'weekly',
    periodStart: '2026-11-02',
    periodEnd: '2026-11-08',
    base,
    otPay,
    bonus,
    deduction,
    advanceTotal,
    extraBonus,
    extraDeduction,
    net: base + otPay + bonus - deduction - overRestDeduction - advanceTotal + extraBonus - extraDeduction,
    hours: 8,
    days: 1,
    otHours: 0,
    entryIds: [],
    advanceIds: [],
    createdAt: '2026-11-08T12:00:00.000Z',
    paymentStatus: 'unpaid',
    ...patch,
  };
}

export function makeAdvance(patch: Partial<Advance> = {}): Advance {
  return {
    id: 'advance-1',
    jobId: 'job-1',
    date: '2026-11-01',
    amount: 100,
    createdAt: '2026-11-01T09:00:00.000Z',
    ...patch,
  };
}

export function makeRestDay(patch: Partial<RestDay> = {}): RestDay {
  return {
    id: 'rest-1',
    jobId: 'job-1',
    date: '2026-11-03',
    days: 1,
    createdAt: '2026-11-03T09:00:00.000Z',
    ...patch,
  };
}

export function makeState(patch: Partial<AppState> = {}): AppState {
  const state = createEmptyState('测试');
  state.onboardingDone = true;
  return { ...state, ...patch };
}
