import { describe, expect, it } from 'vitest';
import { monthlyBudgetStatus } from './budget';
import { baseRule, makeEntry } from './testFixtures';

const settings = { enabled: true, incomeTarget: 1000, hoursLimit: 20 };
const work = (id: string, hours: number, date = '2026-11-10') =>
  makeEntry({ id, date, hours, otHours: 0, rule: { ...baseRule, rate: 25, otEnabled: false } });

describe('月度预算提醒', () => {
  it('未开启或没有目标时不提醒', () => {
    expect(monthlyBudgetStatus(undefined, [work('a', 8)], '2026-11-10')).toBeNull();
    expect(monthlyBudgetStatus({ enabled: true, incomeTarget: 0, hoursLimit: 0 }, [], '2026-11-10')).toBeNull();
  });

  it('收入达到 80% 和目标时分别提醒', () => {
    const incomeOnly = { ...settings, hoursLimit: 0 };
    const near = monthlyBudgetStatus(incomeOnly, [work('a', 32)], '2026-11-10');
    expect(near?.income).toBe(800);
    expect(near?.alert?.code).toBe('income-near');
    const reached = monthlyBudgetStatus(incomeOnly, [work('a', 40)], '2026-11-10');
    expect(reached?.alert?.code).toBe('income-reached');
  });

  it('工时达到上限优先于收入目标提示', () => {
    const status = monthlyBudgetStatus(settings, [work('a', 20)], '2026-11-10');
    expect(status?.hoursPercent).toBe(100);
    expect(status?.alert?.code).toBe('hours-exceeded');
  });

  it('排除未来工记', () => {
    const status = monthlyBudgetStatus(settings, [work('future', 40, '2026-11-30')], '2026-11-10');
    expect(status?.income).toBe(0);
    expect(status?.alert).toBeNull();
  });
});
