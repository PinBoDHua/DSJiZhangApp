import { hoursBetween, pad2, toISODate } from './date';

export interface TimerTimes {
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  /** 真实计时时长（小时，两位小数）。跨天或超过 24 小时时，起止钟点不再能反推真实时长。 */
  hours?: number;
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
  const elapsedMs = Math.max(0, endedAt.getTime() - safeStart.getTime());
  return {
    date: toISODate(safeStart),
    startTime: `${pad2(safeStart.getHours())}:${pad2(safeStart.getMinutes())}`,
    endTime: `${pad2(endedAt.getHours())}:${pad2(endedAt.getMinutes())}`,
    breakMinutes: 0,
    // 起止钟点只能表示 0–24 小时；真实时长单独带出，供 >24h 场景使用。
    hours: Math.round((elapsedMs / 3_600_000) * 100) / 100,
  };
}

export function timerHours(times: TimerTimes): number {
  if (times.hours !== undefined) return times.hours;
  return hoursBetween(times.startTime, times.endTime, times.breakMinutes);
}

export function isTimerOverlong(startedAt: string): boolean {
  return elapsedSeconds(startedAt) > 24 * 3600;
}
