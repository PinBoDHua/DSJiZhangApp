import { describe, expect, it } from 'vitest';
import type { Entry, Job, PayRule, Period, RestDay } from '../types';
import { buildAttendanceCsv } from './csv';

const rule = {
  payType: 'monthly',
  rate: 3500,
  standardHours: 6,
  expectedDays: 22,
  monthlyMode: 'fixed',
  restDaysPerMonth: 5,
  restPolicy: 'quota',
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: false,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
} as PayRule;

const job = (id: string, name: string): Job =>
  ({
    id,
    name,
    color: 'pine',
    rule,
    shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
    cycle: 'monthly',
    archived: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  }) as Job;

const entry = (jobId: string, date: string, hours: number): Entry =>
  ({
    id: `entry-${jobId}-${date}`,
    jobId,
    date,
    breakMinutes: 0,
    hours,
    quantity: 0,
    otHours: 0,
    bonus: 0,
    deduction: 0,
    holiday: false,
    rule,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
  }) as Entry;

const rest = (jobId: string, date: string, days: number): RestDay => ({
  id: `rest-${jobId}-${date}`,
  jobId,
  date,
  days,
  createdAt: `${date}T12:00:00.000Z`,
});

const period: Period = {
  start: '2026-11-01',
  end: '2026-11-03',
  key: 'monthly:2026-11',
  label: '2026年11月',
  shortLabel: '11月',
};

describe('月度考勤 CSV', () => {
  it('按日期 × 岗位导出班 / 休 / 未记，并带 BOM', () => {
    const csv = buildAttendanceCsv(
      [job('j1', '老宅装修'), job('j2', '城南工地')],
      [entry('j1', '2026-11-01', 6), entry('j2', '2026-11-01', 8)],
      [rest('j1', '2026-11-02', 0.5)],
      period,
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('日期,星期,老宅装修,城南工地,当日工时');
    expect(csv).toContain('2026-11-01,周日,班 6h,班 8h,14');
    expect(csv).toContain('2026-11-02,周一,休 0.5,未记,0');
    expect(csv).toContain('2026-11-03,周二,未记,未记,0');
    expect(csv).toContain('合计,,1 班 / 0.5 休 / 6h,1 班 / 0 休 / 8h,14');
  });
});
