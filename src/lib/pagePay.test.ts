import { describe, expect, it } from 'vitest';
import type { Entry, PayRule, Settlement } from '../types';
import { periodOf } from './date';
import { dailyBaseSeries, dailySeries, sumEntriesCapped } from './settlement';
import {
  MONEY_INPUT_LIMIT,
  clampMoneyInput,
  exceedsDailyHours,
  fixedMonthlyWholeMonth,
  moneyInputTooLarge,
  monthlyTermsVary,
  overRestDisplay,
  settledEntryIds,
  undoLostPaymentNotice,
} from './pagePay';

const fixedMonthlyRule: PayRule = {
  payType: 'monthly',
  rate: 3500,
  standardHours: 6,
  expectedDays: 22,
  monthlyMode: 'fixed',
  restDaysPerMonth: 5,
  restPolicy: 'quota',
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: false,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
};

function entry(id: string, date: string, rule: PayRule = fixedMonthlyRule): Entry {
  return {
    id,
    jobId: 'job-1',
    date,
    breakMinutes: 0,
    hours: 6,
    quantity: 0,
    otHours: 0,
    bonus: 0,
    deduction: 0,
    holiday: false,
    rule,
    createdAt: `${date}T09:00:00.000Z`,
    updatedAt: `${date}T09:00:00.000Z`,
  };
}

/** 2026-11（30 天）每天记一条固定月薪工记 */
function novemberEntries(): Entry[] {
  return Array.from({ length: 30 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return entry(`e-${day}`, `2026-11-${day}`);
  });
}

describe('金额录入上限（UI-10）', () => {
  it('与导入钳制同值：超过 1e6 截断、负数归零', () => {
    expect(clampMoneyInput(2_000_000)).toBe(MONEY_INPUT_LIMIT);
    expect(clampMoneyInput(-5)).toBe(0);
    expect(clampMoneyInput(123.456)).toBe(123.46);
    expect(clampMoneyInput(Number.NaN)).toBe(0);
    expect(clampMoneyInput(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('超过上限可被页面识别并报错，而不是静默改数', () => {
    expect(moneyInputTooLarge(1_000_000)).toBe(false);
    expect(moneyInputTooLarge(1_000_000.01)).toBe(true);
    expect(moneyInputTooLarge(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('当天 24 小时校验容差（UI-33）', () => {
  it('正好 24 小时、误差在容差内不算超', () => {
    expect(exceedsDailyHours(8.1, 15.9)).toBe(false);
    expect(exceedsDailyHours(23.5, 0.5)).toBe(false);
    expect(exceedsDailyHours(24, 1e-10)).toBe(false);
    expect(exceedsDailyHours(24, 1e-8)).toBe(true);
  });

  it('确实超过 24 小时才判超', () => {
    expect(exceedsDailyHours(23.5, 0.51)).toBe(true);
    expect(exceedsDailyHours(24, 0.0001)).toBe(true);
  });
});

describe('PAY-20 月薪明细快照判定', () => {
  it('同一规则跨多天不算变化', () => {
    expect(monthlyTermsVary([entry('a', '2026-11-01'), entry('b', '2026-11-02')])).toBe(false);
  });

  it('同一天多段只取最新快照：旧快照调价不影响判定', () => {
    const older = { ...entry('a-old', '2026-11-01'), createdAt: '2026-11-01T01:00:00.000Z' };
    const newer = entry('b-new', '2026-11-01');
    const otherDay = entry('c', '2026-11-02');
    expect(monthlyTermsVary([older, newer, otherDay])).toBe(false);
    expect(monthlyTermsVary([otherDay, older, newer])).toBe(false);
  });

  it('不同日期调价 / 改计薪天数 / 改月薪模式算变化', () => {
    const changedRate = {
      ...entry('b', '2026-11-02'),
      rule: { ...fixedMonthlyRule, rate: 4000 },
    };
    expect(monthlyTermsVary([entry('a', '2026-11-01'), changedRate])).toBe(true);
    const changedDays = {
      ...entry('c', '2026-11-03'),
      rule: { ...fixedMonthlyRule, expectedDays: 21 },
    };
    expect(monthlyTermsVary([entry('a', '2026-11-01'), changedDays])).toBe(true);
    const changedMode = {
      ...entry('d', '2026-11-04'),
      rule: { ...fixedMonthlyRule, monthlyMode: 'prorated' as const },
    };
    expect(monthlyTermsVary([entry('a', '2026-11-01'), changedMode])).toBe(true);
  });

  it('非月薪记录不参与判定', () => {
    const hourly = entry('h', '2026-11-02', { ...fixedMonthlyRule, payType: 'hourly' });
    expect(monthlyTermsVary([entry('a', '2026-11-01'), hourly])).toBe(false);
  });
});

describe('PAY-21 固定月薪按整月发放的文案分支', () => {
  it('只有月结岗位才算整月发放', () => {
    expect(fixedMonthlyWholeMonth(['monthly'])).toBe(true);
    expect(fixedMonthlyWholeMonth(['monthly', 'monthly'])).toBe(true);
    expect(fixedMonthlyWholeMonth(['monthly', 'weekly'])).toBe(false);
    expect(fixedMonthlyWholeMonth(['daily'])).toBe(false);
    expect(fixedMonthlyWholeMonth([])).toBe(false);
  });
});

describe('PAY-27 已结算集合', () => {
  it('取结算单 entryIds 并集，不依赖 entry.settlementId', () => {
    const settlements = [
      { entryIds: ['a', 'b'] },
      { entryIds: ['b', 'c'] },
    ] as Settlement[];
    const ids = settledEntryIds(settlements);
    expect(Array.from(ids).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('PAY-28 撤销结算丢失收款提醒', () => {
  const base = {
    id: 's1',
    jobId: 'j1',
    jobName: '测试',
    cycle: 'monthly',
    periodStart: '2026-11-01',
    periodEnd: '2026-11-30',
    payType: 'monthly',
    monthlyMode: 'fixed',
    entries: [],
    entryIds: [],
    advanceIds: [],
    restDays: 0,
    restDates: [],
    hours: 0,
    days: 0,
    otHours: 0,
    quantity: 0,
    base: 3500,
    otPay: 0,
    bonus: 0,
    deduction: 0,
    extraBonus: 0,
    extraDeduction: 0,
    advanceTotal: 0,
    net: 3500,
    createdAt: '2026-11-30T10:00:00.000Z',
  } as unknown as Settlement;

  it('有收款登记时列出金额、日期与方式', () => {
    const text = undoLostPaymentNotice({
      ...base,
      paidAmount: 1200,
      paidAt: '2026-11-30',
      paymentMethod: '微信',
    });
    expect(text).toContain('¥1200');
    expect(text).toContain('2026-11-30');
    expect(text).toContain('微信');
    expect(text).toContain('丢失');
  });

  it('没有收款 / 0 元标记结清不提示', () => {
    expect(undoLostPaymentNotice(base)).toBeNull();
    expect(
      undoLostPaymentNotice({ ...base, paidAmount: 0, paymentStatus: 'paid' }),
    ).toBeNull();
  });
});

describe('PAY-02 超休额度展示', () => {
  it('整月周期显示月休额度且不提示折算', () => {
    const display = overRestDisplay(
      { overRestQuotaDays: 5, overRestAutoDeduction: true },
      5,
    );
    expect(display.autoDeduct).toBe(true);
    expect(display.quota).toBe(5);
    expect(display.quotaText).toBe('月休额度 5 天');
    expect(display.notice).toBeNull();
  });

  it('非整月周期显示本期折算额度，并提示只提示不自动扣', () => {
    const display = overRestDisplay(
      { overRestQuotaDays: 1.17, overRestAutoDeduction: false },
      5,
    );
    expect(display.autoDeduct).toBe(false);
    // formatRestDays 保留一位小数：5 × 7/30 = 1.1667 → 1.2 天
    expect(display.quotaText).toBe('本期折算额度 1.2 天');
    expect(display.notice).toContain('不自动扣超休');
  });
});

describe('PAY-05 封顶口径统一（3500 / 22 天 / 2026-11 全月记工）', () => {
  const entries = novemberEntries();
  const month = periodOf('monthly', '2026-11-15', 1);

  it('记录页月合计封顶为 3500', () => {
    const totals = sumEntriesCapped(entries, month, { periodShareCap: true });
    expect(totals.base).toBe(3500);
    expect(totals.total).toBe(3500);
  });

  it('日历逐日分摊合计与月合计同源（3500）', () => {
    const shares = dailyBaseSeries(entries, month, { periodShareCap: true });
    expect(shares.length).toBe(30);
    const sum = shares.reduce((total, item) => total + item.base, 0);
    expect(Math.round(sum * 100) / 100).toBe(3500);
    expect(Math.max(...shares.map((item) => item.base))).toBeLessThan(3500);
  });

  it('dailySeries 窗口合计 == sumEntriesCapped 窗口合计', () => {
    const series = dailySeries(entries, month.start, month.end, { periodShareCap: true });
    const seriesTotal = series.reduce((total, point) => total + point.earnings, 0);
    expect(Math.round(seriesTotal * 100) / 100).toBe(3500);
    // 周档也同参：周结岗位的固定月薪按周期占当月比例封顶。
    const week = periodOf('weekly', '2026-11-04', 1);
    const weekEntries = entries.filter((item) => item.date >= week.start && item.date <= week.end);
    const weekSeries = dailySeries(weekEntries, week.start, week.end, { periodShareCap: true });
    const weekSeriesTotal = weekSeries.reduce((total, point) => total + point.earnings, 0);
    const weekTotals = sumEntriesCapped(weekEntries, week, { periodShareCap: true });
    expect(Math.round(weekSeriesTotal * 100) / 100).toBe(weekTotals.total);
  });

  it('周结各期合计 3500.02（分币舍入，见 lib 报告）', () => {
    const periodKeys = new Set(
      entries.map((item) => periodOf('weekly', item.date, 1).key),
    );
    let total = 0;
    for (const key of periodKeys) {
      const week = periodOf('weekly', key.slice('weekly:'.length), 1);
      const weekEntries = entries.filter(
        (item) => item.date >= week.start && item.date <= week.end,
      );
      total += sumEntriesCapped(weekEntries, week, { periodShareCap: true }).total;
    }
    expect(Math.round(total * 100) / 100).toBe(3500.02);
  });
});
