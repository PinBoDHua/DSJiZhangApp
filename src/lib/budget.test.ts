import { afterEach, describe, expect, it, vi } from 'vitest';
import { monthlyBudgetStatus, shouldToastBudgetAlert } from './budget';
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
describe('预算口径与提醒', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('函数自身按月过滤：传跨月工记只统计 today 所在月（PAY-28）', () => {
    const status = monthlyBudgetStatus(
      settings,
      [work('oct', 8, '2026-10-31'), work('nov', 8, '2026-11-10')],
      '2026-11-10',
    );
    expect(status?.income).toBe(200);
  });

  it('固定月薪按整月估算（B8 行为钉住）', () => {
    const fixedRule = {
      ...baseRule,
      payType: 'monthly' as const,
      rate: 3500,
      expectedDays: 22,
      monthlyMode: 'fixed' as const,
      otEnabled: false,
    };
    const status = monthlyBudgetStatus(
      { enabled: true, incomeTarget: 5000, hoursLimit: 0 },
      [makeEntry({ id: 'fixed', date: '2026-11-03', hours: 6, rule: fixedRule })],
      '2026-11-10',
    );
    // 整月口径：2 天出勤也按固定月薪 3500 估算，不是逐日折算。
    expect(status?.income).toBe(3500);
  });

  it('预算 toast 按档位键去重，不同档位 / 不同月各提醒一次（PAY-17）', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    const incomeOnly = { ...settings, hoursLimit: 0 };
    const near = monthlyBudgetStatus(incomeOnly, [work('a', 32)], '2026-11-10');
    const reached = monthlyBudgetStatus(incomeOnly, [work('a', 40)], '2026-11-10');
    expect(shouldToastBudgetAlert('2026-11', near)).toBe(true);
    expect(shouldToastBudgetAlert('2026-11', near)).toBe(false);
    // 档位升级是新键，仍提醒一次（旧实现单键会互相覆盖）。
    expect(shouldToastBudgetAlert('2026-11', reached)).toBe(true);
    expect(shouldToastBudgetAlert('2026-11', reached)).toBe(false);
    expect(shouldToastBudgetAlert('2026-12', reached)).toBe(true);
  });

  it('存储不可用时同键 30 分钟内只提醒一次，避免每次渲染刷屏', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    const status = monthlyBudgetStatus(
      { ...settings, hoursLimit: 0 },
      [work('a', 32)],
      '2026-11-10',
    );
    expect(shouldToastBudgetAlert('2026-11', status)).toBe(true);
    expect(shouldToastBudgetAlert('2026-11', status)).toBe(false);
  });
});

