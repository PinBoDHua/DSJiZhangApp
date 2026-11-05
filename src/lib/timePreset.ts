import { pad2 } from './date';

export const DURATION_PRESETS = [4, 6, 8, 10, 12] as const;

/** 在 HH:mm 上加减分钟，跨零点自动折回。 */
export function addMinutesToTime(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map((value) => Number(value) || 0);
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

/** 以开始时间和休息分钟数算出结束时间。 */
export function endTimeForDuration(
  startTime: string,
  hours: number,
  breakMinutes = 0,
): string {
  return addMinutesToTime(startTime, Math.round(hours * 60) + Math.max(0, breakMinutes));
}
