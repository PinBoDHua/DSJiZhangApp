import type { Job } from '../types';
import type { NewEntryInput } from '../store';
import { hoursBetween } from './date';
import { round2 } from './money';
import { autoOtHours } from './pay';

export interface PlannedEntryOptions {
  hours?: number;
  bonus?: number;
  note?: string;
}

export function plannedEntryHours(job: Job): number {
  return Math.min(
    24,
    Math.max(
      0,
      hoursBetween(job.shift.startTime, job.shift.endTime, job.shift.breakMinutes),
    ),
  );
}

export function makePlannedEntry(
  job: Job,
  date: string,
  options: PlannedEntryOptions = {},
): NewEntryInput | null {
  if (job.rule.payType === 'piece') return null;
  const defaultHours = plannedEntryHours(job);
  const hours = options.hours ?? defaultHours;
  if (hours <= 0 || hours > 24) return null;
  const hourly = job.rule.payType === 'hourly';
  const customHours =
    options.hours !== undefined && Math.abs(hours - defaultHours) > 0.001;
  const keepTimes = hourly && !customHours;
  return {
    jobId: job.id,
    date,
    hours: round2(hours),
    quantity: 0,
    otHours: hourly && job.rule.otEnabled ? autoOtHours(hours, job.rule) : 0,
    bonus: round2(Math.max(0, options.bonus ?? 0)),
    deduction: 0,
    holiday: false,
    note: options.note?.trim() || '排班补记',
    rule: { ...job.rule },
    breakMinutes: keepTimes ? job.shift.breakMinutes : 0,
    startTime: keepTimes ? job.shift.startTime : undefined,
    endTime: keepTimes ? job.shift.endTime : undefined,
  };
}
