import { pad2 } from './date';

export const REMINDER_LAST_KEY = 'xinshi.reminder.last';

export function clearReminderMark(): void {
  try {
    localStorage.removeItem(REMINDER_LAST_KEY);
  } catch {
    // 忽略存储失败
  }
}

export function notificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationSupported()) return 'unsupported';
  return Notification.permission;
}

export async function askNotificationPermission(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (!notificationSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function reminderDue(time: string, now = new Date()): boolean {
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
  return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
}

export async function showLocalNotification(
  title: string,
  body: string,
  tag = 'xinshi',
): Promise<boolean> {
  if (!notificationSupported() || Notification.permission !== 'granted') return false;
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag,
        });
        return true;
      }
    }
    new Notification(title, { body, icon: '/icons/icon-192.png', tag });
    return true;
  } catch {
    return false;
  }
}

const ICS_MAX_OCTETS = 75;

/** 按 RFC5545 折行：每行 UTF-8 不超过 75 字节、续行以单个空格开头，且不拆多字节字符。 */
function foldIcsLine(line: string): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= ICS_MAX_OCTETS) return [line];
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = ICS_MAX_OCTETS;
  for (const char of line) {
    const charBytes = encoder.encode(char).length;
    if (currentBytes + charBytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      // 续行行首的一个空格也占 1 字节。
      limit = ICS_MAX_OCTETS - 1;
    }
    current += char;
    currentBytes += charBytes;
  }
  if (current) parts.push(current);
  return parts;
}

/** 折行后以 CRLF 连接；续行加一个前导空格（unfold 时会被去掉）。 */
export function foldIcsLines(lines: string[]): string {
  const folded: string[] = [];
  for (const line of lines) {
    foldIcsLine(line).forEach((part, index) => {
      folded.push(index === 0 ? part : ` ${part}`);
    });
  }
  return folded.join('\r\n');
}

function icsLocal(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(
    date.getHours(),
  )}${pad2(date.getMinutes())}00`;
}

function icsUtc(date: Date): string {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(
    date.getUTCDate(),
  )}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(
    date.getUTCSeconds(),
  )}Z`;
}

export function buildReminderIcs(time: string): string {
  const now = new Date();
  const [hours, minutes] = time.split(':').map(Number);
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number.isFinite(hours) ? hours : 21,
    Number.isFinite(minutes) ? minutes : 0,
    0,
  );
  if (start.getTime() <= now.getTime()) start.setDate(start.getDate() + 1);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Xinshi//Daily Work Reminder//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:xinshi-daily-reminder@xinshi.local',
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsLocal(start)}`,
    `DTEND:${icsLocal(end)}`,
    'RRULE:FREQ=DAILY;COUNT=365',
    'SUMMARY:薪时 · 记工提醒',
    'DESCRIPTION:打开薪时，把今天的工时和工资记上。',
    'BEGIN:VALARM',
    'TRIGGER:PT0M',
    'ACTION:DISPLAY',
    'DESCRIPTION:薪时 · 记工提醒',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${foldIcsLines(lines)}\r\n`;
}

export function downloadReminderIcs(time: string): void {
  const blob = new Blob([buildReminderIcs(time)], {
    type: 'text/calendar;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '薪时-每日记工提醒.ics';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
