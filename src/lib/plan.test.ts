import { describe, expect, it } from 'vitest';
import type { Entry, Job, RestDay } from '../types';
import { plannedWorkDates, planStatusForJob, shortWeekday, weekdayOf } from './plan';

const rule = {
  payType: 'monthly' as const,
  rate: 3500,
  standardHours: 6,
  expectedDays: 22,
  monthlyMode: 'fixed' as const,
  restDaysPerMonth: 5,
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: false,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
};

const job: Job = {
  id: 'job-1',
  name: '长期工',
  color: 'clay',
  rule,
  shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
  cycle: 'monthly',
  archived: false,
  workWeekdays: [1, 2, 3, 4, 5, 6],
  createdAt: '2026-11-01T00:00:00.000Z',
};

const entry = (date: string): Entry => ({
  id: `entry-${date}`,
  jobId: 'job-1',
  date,
  breakMinutes: 120,
  hours: 6,
  quantity: 0,
  otHours: 0,
  bonus: 0,
  deduction: 0,
  holiday: false,
  rule,
  createdAt: `${date}T12:00:00.000Z`,
  updatedAt: `${date}T12:00:00.000Z`,
});

const rest = (date: string): RestDay => ({
  id: `rest-${date}`,
  jobId: 'job-1',
  date,
  createdAt: `${date}T12:00:00.000Z`,
});

describe('固定周排班', () => {
  it('识别周一至周六上班、周日休息', () => {
    expect(weekdayOf('2026-11-08')).toBe(0);
    expect(shortWeekday('2026-11-08')).toBe('日');
    expect(planStatusForJob(job, '2026-11-08', [], [])).toBe('off');
    expect(planStatusForJob(job, '2026-11-09', [], [])).toBe('work');
  });

  it('实际工记优先于计划，休息标记优先于模板', () => {
    expect(planStatusForJob(job, '2026-11-09', [entry('2026-11-09')], [])).toBe('worked');
    expect(planStatusForJob(job, '2026-11-09', [], [rest('2026-11-09')])).toBe('rest');
  });

  it('只列出还没有工记 / 休息的计划上班日', () => {
    const dates = plannedWorkDates(
      [job],
      [entry('2026-11-09')],
      [rest('2026-11-10')],
      '2026-11-08',
      '2026-11-12',
    );
    expect(dates).toEqual(['2026-11-11', '2026-11-12']);
  });

  it('不固定上班日的工作不产生计划', () => {
    const flexible = { ...job, workWeekdays: undefined };
    expect(plannedWorkDates([flexible], [], [], '2026-11-01', '2026-11-30')).toEqual([]);
  });
});
