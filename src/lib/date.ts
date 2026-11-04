import type { Cycle, Period, WeekStart } from '../types';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function addMonths(iso: string, months: number): string {
  const date = parseISODate(iso);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, last));
  return toISODate(date);
}

export function startOfWeek(iso: string, weekStartsOn: WeekStart = 1): string {
  const date = parseISODate(iso);
  const diff = (date.getDay() - weekStartsOn + 7) % 7;
  date.setDate(date.getDate() - diff);
  return toISODate(date);
}

export function endOfWeek(iso: string, weekStartsOn: WeekStart = 1): string {
  return addDays(startOfWeek(iso, weekStartsOn), 6);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const date = parseISODate(iso);
  return toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function daysInMonth(iso: string): number {
  const date = parseISODate(iso);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 370) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}

export function isWeekend(iso: string): boolean {
  const day = parseISODate(iso).getDay();
  return day === 0 || day === 6;
}

export function weekdayCN(iso: string): string {
  return WEEKDAYS[parseISODate(iso).getDay()];
}

export function weekdayShort(iso: string): string {
  return weekdayCN(iso).replace('周', '');
}

export function formatDateShort(iso: string): string {
  const date = parseISODate(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function formatDateCompact(iso: string): string {
  const date = parseISODate(iso);
  return `${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

export function formatDateWithWeekday(iso: string): string {
  return `${formatDateShort(iso)} ${weekdayCN(iso)}`;
}

export function formatDateFull(iso: string): string {
  const date = parseISODate(iso);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdayCN(iso)}`;
}

export function formatMonthTitle(iso: string): string {
  const date = parseISODate(iso);
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function formatMonthShort(iso: string): string {
  const date = parseISODate(iso);
  return `${date.getMonth() + 1}月`;
}

export function formatTimeRange(start?: string, end?: string): string {
  if (!start || !end) return '';
  return `${start}–${end}`;
}

export function relativeDayLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return '今天';
  if (iso === addDays(today, -1)) return '昨天';
  if (iso === addDays(today, -2)) return '前天';
  return '';
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function periodOf(cycle: Cycle, anchor: string, weekStartsOn: WeekStart = 1): Period {
  if (cycle === 'daily') {
    return {
      start: anchor,
      end: anchor,
      key: `daily:${anchor}`,
      label: formatDateWithWeekday(anchor),
      shortLabel: formatDateShort(anchor),
    };
  }
  if (cycle === 'weekly') {
    const start = startOfWeek(anchor, weekStartsOn);
    const end = addDays(start, 6);
    const crossYear = start.slice(0, 4) !== end.slice(0, 4);
    const label = crossYear
      ? `${start.slice(0, 4)}年${formatDateShort(start)} – ${end.slice(0, 4)}年${formatDateShort(end)}`
      : `${formatDateShort(start)} – ${formatDateShort(end)}`;
    return {
      start,
      end,
      key: `weekly:${start}`,
      label,
      shortLabel: `${formatDateShort(start)}起`,
    };
  }
  const start = startOfMonth(anchor);
  const end = endOfMonth(anchor);
  return {
    start,
    end,
    key: `monthly:${start.slice(0, 7)}`,
    label: formatMonthTitle(anchor),
    shortLabel: formatMonthShort(anchor),
  };
}

export function periodContains(period: Period, iso: string): boolean {
  return iso >= period.start && iso <= period.end;
}

export function shiftPeriod(period: Period, delta: number, weekStartsOn: WeekStart = 1): Period {
  const cycle = period.key.split(':')[0] as Cycle;
  if (cycle === 'daily') return periodOf('daily', addDays(period.start, delta), weekStartsOn);
  if (cycle === 'weekly') return periodOf('weekly', addDays(period.start, delta * 7), weekStartsOn);
  return periodOf('monthly', addMonths(period.start, delta), weekStartsOn);
}

export function comparePeriods(a: Period, b: Period): number {
  return a.start.localeCompare(b.start);
}

export function periodKeyOf(cycle: Cycle, iso: string, weekStartsOn: WeekStart = 1): string {
  return periodOf(cycle, iso, weekStartsOn).key;
}

/** 计算时间区间工时（小时，保留两位） */
export function hoursBetween(start: string, end: string, breakMinutes = 0): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if ([sh, sm, eh, em].some((value) => Number.isNaN(value))) return 0;
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60;
  if (minutes === 0) return 0;
  const worked = Math.max(0, minutes - Math.max(0, breakMinutes));
  return Math.round((worked / 60) * 100) / 100;
}

export function formatDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())} ${pad2(
    date.getHours(),
  )}:${pad2(date.getMinutes())}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}
