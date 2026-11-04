import { describe, expect, it } from 'vitest';
import type { Job, PayRule } from '../types';
import { makePlannedEntry, plannedEntryHours } from './planEntries';

const rule = (overrides: Partial<PayRule> = {}): PayRule => ({
  payType: 'monthly',
  rate: 3500,
  standardHours: 6,
  expectedDays: 22,
  monthlyMode: 'fixed',
  restDaysPerMonth: 5,
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: false,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
  ...overrides,
});

const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  name: '长期工',
  color: 'clay',
  rule: rule(),
  shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
  cycle: 'monthly',
  archived: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

describe('按排班生成默认工记', () => {
  it('固定月薪按班次生成 6h，不带起止时间', () => {
    const input = makePlannedEntry(job(), '2026-11-06');
    expect(input).not.toBeNull();
    expect(input?.hours).toBe(6);
    expect(input?.startTime).toBeUndefined();
    expect(input?.endTime).toBeUndefined();
    expect(input?.breakMinutes).toBe(0);
    expect(input?.note).toBe('排班补记');
  });

  it('日薪按班次净工时生成', () => {
    const daily = job({
      rule: rule({ payType: 'daily', rate: 320, standardHours: 8, otEnabled: true }),
      shift: { startTime: '08:00', endTime: '18:00', breakMinutes: 60 },
      cycle: 'weekly',
    });
    expect(plannedEntryHours(daily)).toBe(9);
    expect(makePlannedEntry(daily, '2026-11-06')?.hours).toBe(9);
  });

  it('时薪保留起止时间和午休，并自动计算加班', () => {
    const hourly = job({
      rule: rule({
        payType: 'hourly',
        rate: 30,
        standardHours: 8,
        otEnabled: true,
      }),
      shift: { startTime: '08:00', endTime: '18:00', breakMinutes: 60 },
      cycle: 'weekly',
    });
    const input = makePlannedEntry(hourly, '2026-11-06');
    expect(input?.hours).toBe(9);
    expect(input?.startTime).toBe('08:00');
    expect(input?.endTime).toBe('18:00');
    expect(input?.breakMinutes).toBe(60);
    expect(input?.otHours).toBeGreaterThan(0);
  });

  it('计件岗位不批量生成', () => {
    const piece = job({ rule: rule({ payType: 'piece', rate: 1.2 }) });
    expect(makePlannedEntry(piece, '2026-11-06')).toBeNull();
  });
});
