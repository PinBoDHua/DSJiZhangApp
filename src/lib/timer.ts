import { hoursBetween, pad2, toISODate } from './date';

export interface TimerTimes {
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
}

export function elapsedSeconds(startedAt: string, now = Date.now()): number {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.floor((now - start) / 1000));
}

export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}`;
}

export function buildTimerTimes(startedAt: string, endedAt = new Date()): TimerTimes {
  const start = new Date(startedAt);
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start;
  return {
    date: toISODate(safeStart),
    startTime: `${pad2(safeStart.getHours())}:${pad2(safeStart.getMinutes())}`,
    endTime: `${pad2(endedAt.getHours())}:${pad2(endedAt.getMinutes())}`,
    breakMinutes: 0,
  };
}

export function timerHours(times: TimerTimes): number {
  return hoursBetween(times.startTime, times.endTime, times.breakMinutes);
}

export function isTimerOverlong(startedAt: string): boolean {
  return elapsedSeconds(startedAt) > 24 * 3600;
}
