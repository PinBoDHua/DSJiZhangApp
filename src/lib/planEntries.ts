import type { Job } from '../types';
import type { NewEntryInput } from '../store';
import { hoursBetween } from './date';
import { round2 } from './money';
import { autoOtHours } from './pay';

export function plannedEntryHours(job: Job): number {
  return Math.min(
    24,
    Math.max(
      0,
      hoursBetween(job.shift.startTime, job.shift.endTime, job.shift.breakMinutes),
    ),
  );
}

export function makePlannedEntry(job: Job, date: string): NewEntryInput | null {
  if (job.rule.payType === 'piece') return null;
  const hours = plannedEntryHours(job);
  if (hours <= 0) return null;
  const hourly = job.rule.payType === 'hourly';
  return {
    jobId: job.id,
    date,
    hours: round2(hours),
    quantity: 0,
    otHours: hourly && job.rule.otEnabled ? autoOtHours(hours, job.rule) : 0,
    bonus: 0,
    deduction: 0,
    holiday: false,
    note: '排班补记',
    rule: { ...job.rule },
    breakMinutes: hourly ? job.shift.breakMinutes : 0,
    startTime: hourly ? job.shift.startTime : undefined,
    endTime: hourly ? job.shift.endTime : undefined,
  };
}
