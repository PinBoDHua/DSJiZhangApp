import { describe, expect, it } from 'vitest';
import { buildReminderIcs, reminderDue } from './reminder';

describe('记工提醒', () => {
  it('到达设定时间才提醒', () => {
    expect(reminderDue('09:00', new Date(2026, 10, 4, 8, 59))).toBe(false);
    expect(reminderDue('09:00', new Date(2026, 10, 4, 9, 0))).toBe(true);
    expect(reminderDue('21:30', new Date(2026, 10, 4, 23, 10))).toBe(true);
  });

  it('生成可导入系统日历的每日提醒', () => {
    const ics = buildReminderIcs('21:30');
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('RRULE:FREQ=DAILY;COUNT=365');
    expect(ics).toContain('T213000');
    expect(ics).toContain('SUMMARY:薪时 · 记工提醒');
    expect(ics).toContain('BEGIN:VALARM');
  });
});
