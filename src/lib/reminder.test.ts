import { describe, expect, it } from 'vitest';
import { buildReminderIcs, foldIcsLines, reminderDue } from './reminder';
import { buildDailyReminderPlan } from './nativeReminders';

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

  it('原生每日提醒排未来 30 天，当天已记工或时间已过则跳过', () => {
    const now = new Date(2026, 10, 5, 20, 0, 0);
    const plan = buildDailyReminderPlan('21:00', true, now);
    expect(plan).toHaveLength(30);
    expect(plan[0].date).toBe('2026-11-05');
    expect(plan[0].at.getHours()).toBe(21);
    expect(plan[0].at.getMinutes()).toBe(0);

    const skipToday = buildDailyReminderPlan('21:00', false, now);
    expect(skipToday).toHaveLength(29);
    expect(skipToday[0].date).toBe('2026-11-06');

    const past = buildDailyReminderPlan('19:00', true, now);
    expect(past[0].date).toBe('2026-11-06');

    expect(buildDailyReminderPlan('25:99', true, now)).toEqual([]);
  });
});
describe('ICS RFC5545 折行', () => {
  const encoder = new TextEncoder();

  it('75 octet 上限、续行以空格开头、不拆 UTF-8 字符', () => {
    const description = `DESCRIPTION:${'中文提醒'.repeat(20)}`;
    const folded = foldIcsLines([description]);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    for (const line of lines.slice(1)) {
      expect(line.startsWith(' ')).toBe(true);
    }
    // unfold 后必须还原原文，且没有拆出替换字符。
    expect(folded.replace(/\r\n /g, '')).toBe(description);
    expect(folded).not.toContain('\uFFFD');
  });

  it('完整 ICS 每行都不超过 75 字节', () => {
    const ics = buildReminderIcs('21:30');
    for (const line of ics.split('\r\n').filter((item) => item.length > 0)) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain('BEGIN:VCALENDAR');
  });
});

