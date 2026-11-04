import type { Entry, Job, RestDay } from '../types';
import { eachDay } from './date';

export type PlanStatus = 'worked' | 'rest' | 'work' | 'off' | 'none';

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00`).getDay();
}

export function planStatusForJob(
  job: Job,
  date: string,
  entries: Entry[],
  restDays: RestDay[],
): PlanStatus {
  if (entries.some((entry) => entry.jobId === job.id && entry.date === date)) {
    return 'worked';
  }
  if (restDays.some((rest) => rest.jobId === job.id && rest.date === date)) {
    return 'rest';
  }
  if (job.workWeekdays && job.workWeekdays.length > 0) {
    return job.workWeekdays.includes(weekdayOf(date)) ? 'work' : 'off';
  }
  return 'none';
}

export function plannedWorkDates(
  jobs: Job[],
  entries: Entry[],
  restDays: RestDay[],
  start: string,
  end: string,
): string[] {
  const templateJobs = jobs.filter(
    (job) => !job.archived && job.workWeekdays && job.workWeekdays.length > 0,
  );
  if (templateJobs.length === 0) return [];
  const dates: string[] = [];
  for (const date of eachDay(start, end)) {
    const weekday = weekdayOf(date);
    const planned = templateJobs.some(
      (job) =>
        job.workWeekdays?.includes(weekday) &&
        planStatusForJob(job, date, entries, restDays) === 'work',
    );
    if (planned) dates.push(date);
  }
  return dates;
}

export function shortWeekday(date: string): string {
  return ['日', '一', '二', '三', '四', '五', '六'][weekdayOf(date)];
}

export function formatWorkWeekdays(days: number[]): string {
  const unique = Array.from(new Set(days)).sort((a, b) => a - b);
  if (unique.length === 0) return '不固定';
  if (unique.length === 7) return '每天';
  if (
    unique.length === 6 &&
    unique.includes(1) &&
    unique.includes(2) &&
    unique.includes(3) &&
    unique.includes(4) &&
    unique.includes(5) &&
    unique.includes(6)
  ) {
    return '周一至周六';
  }
  if (
    unique.length === 6 &&
    unique.includes(0) &&
    unique.includes(1) &&
    unique.includes(2) &&
    unique.includes(3) &&
    unique.includes(4) &&
    unique.includes(5)
  ) {
    return '周日至周五';
  }
  return unique.map((day) => `周${['日', '一', '二', '三', '四', '五', '六'][day]}`).join('、');
}
