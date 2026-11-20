import { describe, expect, it } from 'vitest';
import type { Advance, AppState, Entry, Job, PayRule, RestDay } from '../types';
import {
  buildSettlementDraft,
  commitSettlement,
  computeOutstanding,
  dailyBaseSeries,
  dailySeries,
  getSettlementOverview,
  makeSettlement,
  settlementCopyText,
  sumEntries,
  sumEntriesCapped,
} from './settlement';
import { payForEntry } from './pay';
import { addMonths, endOfWeek, hoursBetween, periodOf, shiftPeriod, startOfWeek } from './date';
import { formatMoney, round2 } from './money';
import { makeState } from './testFixtures';

const rule = (overrides: Partial<PayRule> & Pick<PayRule, 'payType' | 'rate'>): PayRule => ({
  standardHours: 8,
  expectedDays: 22,
  monthlyMode: 'prorated',
  restDaysPerMonth: 0,
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: true,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
  ...overrides,
});

const job = (overrides: Partial<Job> = {}): Job => ({
  id: 'job-1',
  name: '测试工作',
  color: 'pine',
  shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
  cycle: 'weekly',
  archived: false,
  createdAt: '2026-11-01T00:00:00.000Z',
  rule: rule({ payType: 'hourly', rate: 25 }),
  ...overrides,
});

const entry = (overrides: Partial<Entry> & Pick<Entry, 'date'>): Entry => ({
  id: `entry-${overrides.date}-${Math.random().toString(36).slice(2, 6)}`,
  jobId: 'job-1',
  breakMinutes: 0,
  hours: 8,
  quantity: 0,
  otHours: 0,
  bonus: 0,
  deduction: 0,
  holiday: false,
  rule: rule({ payType: 'hourly', rate: 25 }),
  createdAt: `${overrides.date}T12:00:00.000Z`,
  updatedAt: `${overrides.date}T12:00:00.000Z`,
  ...overrides,
});

const advance = (overrides: Partial<Advance> & Pick<Advance, 'date'>): Advance => ({
  id: `advance-${overrides.date}`,
  jobId: 'job-1',
  amount: 100,
  createdAt: `${overrides.date}T09:00:00.000Z`,
  ...overrides,
});

const state = (partial: Partial<AppState>): AppState => ({
  version: 7,
  profile: { name: '测试', hideAmounts: false },
  settings: {
    weekStartsOn: 1,
    theme: 'system',
    reminder: { enabled: false, time: '21:00' },
  },
  jobs: [job()],
  trashedJobs: [],
  trashedEntries: [],
  trashedRests: [],
  trashedAdvances: [],
  entries: [],
  restDays: [],
  advances: [],
  settlements: [],
  activeTimer: null,
  onboardingDone: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  ...partial,
});

describe('时薪计算', () => {
  it('平日超过标准工时按 1.5 倍计算', () => {
    const pay = payForEntry(
      entry({
        date: '2026-11-04',
        hours: 9,
        otHours: 1,
      }),
    );
    expect(pay.base).toBe(200);
    expect(pay.otPay).toBe(37.5);
    expect(pay.total).toBe(237.5);
    expect(pay.multiplier).toBe(1.5);
  });

  it('周末加班按 2 倍计算', () => {
    const pay = payForEntry(entry({ date: '2026-11-01', hours: 9, otHours: 1 }));
    expect(pay.multiplier).toBe(2);
    expect(pay.otPay).toBe(50);
    expect(pay.total).toBe(250);
  });

  it('法定节假日按 3 倍计算', () => {
    const pay = payForEntry(
      entry({ date: '2026-11-04', hours: 9, otHours: 1, holiday: true }),
    );
    expect(pay.multiplier).toBe(3);
    expect(pay.otPay).toBe(75);
    expect(pay.total).toBe(275);
  });

  it('关闭加班后所有工时按基础时薪计算', () => {
    const pay = payForEntry(
      entry({
        date: '2026-11-04',
        hours: 9,
        otHours: 1,
        rule: rule({ payType: 'hourly', rate: 25, otEnabled: false }),
      }),
    );
    expect(pay.base).toBe(225);
    expect(pay.otPay).toBe(0);
    expect(pay.total).toBe(225);
  });

  it('加班时长不会超过总工时', () => {
    const pay = payForEntry(entry({ date: '2026-11-04', hours: 8, otHours: 10 }));
    expect(pay.otHours).toBe(8);
    expect(pay.base).toBe(0);
  });

  it('奖金与扣款计入合计', () => {
    const pay = payForEntry(
      entry({ date: '2026-11-04', hours: 8, bonus: 30, deduction: 10 }),
    );
    expect(pay.total).toBe(220);
  });
});

describe('日薪计算', () => {
  it('基础日薪 + 平日加班', () => {
    const pay = payForEntry(
      entry({
        date: '2026-11-04',
        hours: 9,
        otHours: 1,
        rule: rule({ payType: 'daily', rate: 320 }),
      }),
    );
    expect(pay.base).toBe(320);
    expect(pay.otRate).toBe(40);
    expect(pay.otPay).toBe(60);
    expect(pay.total).toBe(380);
  });

  it('周末加班 2 倍', () => {
    const pay = payForEntry(
      entry({
        date: '2026-11-01',
        hours: 9,
        otHours: 1,
        rule: rule({ payType: 'daily', rate: 320 }),
      }),
    );
    expect(pay.otPay).toBe(80);
    expect(pay.total).toBe(400);
  });

  it('关闭加班后只算日薪', () => {
    const pay = payForEntry(
      entry({
        date: '2026-11-04',
        hours: 9,
        otHours: 1,
        rule: rule({ payType: 'daily', rate: 320, otEnabled: false }),
      }),
    );
    expect(pay.otPay).toBe(0);
    expect(pay.total).toBe(320);
  });
});

describe('月薪计算', () => {
  it('按计薪天数折算日薪，并计算加班', () => {
    const pay = payForEntry(
      entry({
        date: '2026-11-04',
        hours: 9,
        otHours: 1,
        rule: rule({ payType: 'monthly', rate: 7500 }),
      }),
    );
    expect(pay.base).toBe(340.91);
    expect(pay.otRate).toBe(42.61);
    expect(pay.otPay).toBe(63.92);
    expect(pay.total).toBeCloseTo(404.83, 2);
  });

  it('结算时按整月月薪封顶', () => {
    const monthlyJob = job({
      cycle: 'monthly',
      rule: rule({ payType: 'monthly', rate: 7500 }),
    });
    const entries = Array.from({ length: 23 }, (_, index) =>
      entry({
        date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        hours: 8,
        rule: monthlyJob.rule,
      }),
    );
    const totals = sumEntriesCapped(entries);
    expect(totals.base).toBe(7500);
    expect(totals.capAdjustment).toBeGreaterThan(0);
  });

  it('固定月薪按整月 3500 发放，不因随机休息少发', () => {
    const fixedRule = rule({
      payType: 'monthly',
      rate: 3500,
      standardHours: 6,
      monthlyMode: 'fixed',
      restDaysPerMonth: 5,
      otEnabled: false,
    });
    const monthlyJob = job({ cycle: 'monthly', rule: fixedRule });
    const entries = Array.from({ length: 20 }, (_, index) =>
      entry({
        date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        hours: 6,
        rule: fixedRule,
      }),
    );
    const totals = sumEntriesCapped(entries);
    expect(totals.base).toBe(3500);
    expect(totals.capAdjustment).toBe(0);
    expect(totals.days).toBe(20);
  });

  it('结算单记录固定月薪、休息天数和班次', () => {
    const fixedRule = rule({
      payType: 'monthly',
      rate: 3500,
      standardHours: 6,
      monthlyMode: 'fixed',
      restDaysPerMonth: 5,
      otEnabled: false,
    });
    const monthlyJob = job({
      cycle: 'monthly',
      rule: fixedRule,
      shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
    });
    const period = periodOf('monthly', '2026-11-04', 1);
    const draft = buildSettlementDraft(
      monthlyJob,
      [
        entry({ date: '2026-11-02', hours: 6, rule: fixedRule }),
        entry({ date: '2026-11-03', hours: 6, rule: fixedRule }),
      ],
      [],
      period,
      0,
      0,
      [
        {
          id: 'rest-1',
          jobId: monthlyJob.id,
          date: '2026-11-04',
          createdAt: '2026-11-04T12:00:00.000Z',
        },
        {
          id: 'rest-2',
          jobId: monthlyJob.id,
          date: '2026-12-01',
          createdAt: '2026-12-01T12:00:00.000Z',
        },
      ],
    );
    expect(draft.base).toBe(3500);
    expect(draft.monthlyMode).toBe('fixed');
    expect(draft.restDays).toBe(1);
    expect(monthlyJob.shift.breakMinutes).toBe(120);
  });
});

describe('计件工资', () => {
  it('按数量 × 单价计算，不计加班', () => {
    const pieceRule = rule({ payType: 'piece', rate: 1.2, unitLabel: '件' });
    const pay = payForEntry(
      entry({
        date: '2026-11-04',
        hours: 6,
        quantity: 120,
        otHours: 3,
        bonus: 10,
        deduction: 4,
        rule: pieceRule,
      }),
    );
    expect(pay.base).toBe(144);
    expect(pay.otPay).toBe(0);
    expect(pay.otHours).toBe(0);
    expect(pay.total).toBe(150);
  });

  it('支持米 / 平方等小数数量', () => {
    const pay = payForEntry(
      entry({
        date: '2026-11-04',
        hours: 0,
        quantity: 12.5,
        rule: rule({ payType: 'piece', rate: 4, unitLabel: '米' }),
      }),
    );
    expect(pay.base).toBe(50);
  });

  it('结算快照记录计件类型、数量和单位', () => {
    const pieceJob = job({
      cycle: 'weekly',
      rule: rule({ payType: 'piece', rate: 2, unitLabel: '件' }),
    });
    const draft = buildSettlementDraft(
      pieceJob,
      [
        entry({ date: '2026-11-03', hours: 4, quantity: 100, rule: pieceJob.rule }),
        entry({ date: '2026-11-04', hours: 3, quantity: 50, rule: pieceJob.rule }),
      ],
      [],
      periodOf('weekly', '2026-11-04', 1),
    );
    expect(draft.base).toBe(300);
    expect(draft.quantity).toBe(150);
    expect(draft.unitLabel).toBe('件');
    expect(draft.payType).toBe('piece');
    expect(draft.days).toBe(2);
  });
});

describe('日期与工时', () => {
  it('按周一 / 周日计算周起止', () => {
    expect(startOfWeek('2026-11-04', 1)).toBe('2026-11-02');
    expect(endOfWeek('2026-11-04', 1)).toBe('2026-11-08');
    expect(startOfWeek('2026-11-01', 0)).toBe('2026-11-01');
  });

  it('跨零点计算工时并扣休息', () => {
    expect(hoursBetween('20:00', '04:00', 30)).toBe(7.5);
    expect(hoursBetween('08:00', '17:30', 30)).toBe(9);
    expect(hoursBetween('08:00', '08:00')).toBe(0);
  });

  it('月末日期加减不溢出', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-30', 1)).toBe('2026-12-30');
  });

  it('周期标签和切换', () => {
    const week = periodOf('weekly', '2026-11-04', 1);
    expect(week.start).toBe('2026-11-02');
    expect(week.end).toBe('2026-11-08');
    expect(shiftPeriod(week, -1, 1).start).toBe('2026-10-26');
    const month = periodOf('monthly', '2026-11-04', 1);
    expect(month.start).toBe('2026-11-01');
    expect(month.end).toBe('2026-11-30');
    expect(month.label).toBe('2026年11月');
  });

  it('金额四舍五入到分', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(formatMoney(1234.5, { symbol: true })).toBe('¥1,234.50');
    expect(formatMoney(-20)).toBe('-20.00');
  });
});

describe('结算汇总', () => {
  it('汇总记录、奖金扣款与借支', () => {
    const draft = buildSettlementDraft(
      job(),
      [
        entry({ date: '2026-11-03', hours: 8 }),
        entry({ date: '2026-11-04', hours: 9, otHours: 1, bonus: 30, deduction: 10 }),
      ],
      [advance({ date: '2026-11-02', amount: 100 })],
      periodOf('weekly', '2026-11-04', 1),
    );
    expect(draft.base).toBe(400);
    expect(draft.otPay).toBe(37.5);
    expect(draft.bonus).toBe(30);
    expect(draft.deduction).toBe(10);
    expect(draft.advanceTotal).toBe(100);
    expect(draft.net).toBe(357.5);
    expect(draft.days).toBe(2);
  });

  it('周期结束后的借支不在本期抵扣', () => {
    const draft = buildSettlementDraft(
      job(),
      [entry({ date: '2026-11-03' })],
      [advance({ date: '2026-11-10', amount: 100 })],
      periodOf('weekly', '2026-11-04', 1),
    );
    expect(draft.advanceTotal).toBe(0);
    expect(draft.net).toBe(200);
  });

  it('已结算记录不重复纳入', () => {
    const draft = buildSettlementDraft(
      job(),
      [entry({ date: '2026-11-03', settlementId: 'settled-1' })],
      [],
      periodOf('weekly', '2026-11-04', 1),
    );
    expect(draft.entries).toHaveLength(0);
    expect(draft.net).toBe(0);
  });

  it('月薪部分出勤按天折算并抵扣借支', () => {
    const monthlyJob = job({
      cycle: 'monthly',
      rule: rule({ payType: 'monthly', rate: 7500 }),
    });
    const entries = Array.from({ length: 10 }, (_, index) =>
      entry({
        date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        rule: monthlyJob.rule,
      }),
    );
    const draft = buildSettlementDraft(
      monthlyJob,
      entries,
      [advance({ date: '2026-11-05', amount: 500 })],
      periodOf('monthly', '2026-11-04', 1),
    );
    expect(draft.base).toBe(3409.09);
    expect(draft.net).toBe(2909.09);
  });

  it('固定月薪超休按天扣款，单期可关闭或改金额', () => {
    const fixedJob = job({
      cycle: 'monthly',
      rule: rule({
        payType: 'monthly',
        rate: 3500,
        standardHours: 6,
        monthlyMode: 'fixed',
        restDaysPerMonth: 5,
        overRestDeduct: true,
        otEnabled: false,
      }),
    });
    const work = entry({
      date: '2026-11-03',
      hours: 6,
      rule: fixedJob.rule,
    });
    const restDays: RestDay[] = [1, 2, 4, 5, 6, 7, 8].map((day) => ({
      id: `rest-${day}`,
      jobId: 'job-1',
      date: `2026-11-${String(day).padStart(2, '0')}`,
      createdAt: '2026-11-01T00:00:00.000Z',
    }));
    const period = periodOf('monthly', '2026-11-03', 1);
    const draft = buildSettlementDraft(
      fixedJob,
      [work],
      [],
      period,
      0,
      0,
      restDays,
    );
    expect(draft.overRestDays).toBe(2);
    expect(draft.overRestDeduction).toBe(318.18);
    expect(draft.net).toBe(3181.82);

    const noDeduct = buildSettlementDraft(
      fixedJob,
      [work],
      [],
      period,
      0,
      0,
      restDays,
      false,
    );
    expect(noDeduct.overRestDeduction).toBe(0);
    expect(noDeduct.net).toBe(3500);

    const override = buildSettlementDraft(
      fixedJob,
      [work],
      [],
      period,
      0,
      0,
      restDays,
      true,
      200,
    );
    expect(override.overRestDeduction).toBe(200);
    expect(override.net).toBe(3300);

    // 月结页取消休息后，之前填过的超休金额不能继续扣。
    const noOver = buildSettlementDraft(
      fixedJob,
      [work],
      [],
      period,
      0,
      0,
      restDays.slice(0, 5),
      true,
      200,
    );
    expect(noOver.overRestDays).toBe(0);
    expect(noOver.overRestDeduction).toBe(0);
    expect(noOver.net).toBe(3500);
  });

  it('结算只收本期、本岗位的休息日，并按日期排序去重', () => {
    const fixedJob = job({
      cycle: 'monthly',
      rule: rule({
        payType: 'monthly',
        rate: 3500,
        standardHours: 6,
        monthlyMode: 'fixed',
        restDaysPerMonth: 5,
        overRestDeduct: false,
        otEnabled: false,
      }),
    });
    const period = periodOf('monthly', '2026-11-03', 1);
    const restDays: RestDay[] = [
      {
        id: 'rest-3',
        jobId: 'job-1',
        date: '2026-11-03',
        createdAt: '2026-11-03T12:00:00.000Z',
      },
      {
        id: 'rest-10',
        jobId: 'job-1',
        date: '2026-11-10',
        createdAt: '2026-11-10T12:00:00.000Z',
      },
      {
        id: 'rest-3-duplicate',
        jobId: 'job-1',
        date: '2026-11-03',
        createdAt: '2026-11-03T13:00:00.000Z',
      },
      {
        id: 'rest-other-job',
        jobId: 'job-2',
        date: '2026-11-04',
        createdAt: '2026-11-04T12:00:00.000Z',
      },
      {
        id: 'rest-next-month',
        jobId: 'job-1',
        date: '2026-12-01',
        createdAt: '2026-12-01T12:00:00.000Z',
      },
    ];
    const draft = buildSettlementDraft(
      fixedJob,
      [entry({ date: '2026-11-05', hours: 6, rule: fixedJob.rule })],
      [],
      period,
      0,
      0,
      restDays,
    );
    expect(draft.restDays).toBe(2);
    expect(draft.restDates).toEqual(['2026-11-03', '2026-11-10']);
  });

  it('随机休息不设额度，不产生超休扣款', () => {
    const flexibleJob = job({
      cycle: 'monthly',
      rule: rule({
        payType: 'monthly',
        rate: 3500,
        standardHours: 6,
        monthlyMode: 'fixed',
        restDaysPerMonth: 0,
        restPolicy: 'flexible',
        overRestDeduct: true,
        otEnabled: false,
      }),
    });
    const restDays: RestDay[] = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      id: `rest-${day}`,
      jobId: 'job-1',
      date: `2026-11-${String(day).padStart(2, '0')}`,
      createdAt: '2026-11-01T00:00:00.000Z',
    }));
    const draft = buildSettlementDraft(
      flexibleJob,
      [entry({ date: '2026-11-20', hours: 6, rule: flexibleJob.rule })],
      [],
      periodOf('monthly', '2026-11-03', 1),
      0,
      0,
      restDays,
    );
    expect(draft.restDays).toBe(7);
    expect(draft.overRestDays).toBe(0);
    expect(draft.overRestDeduction).toBe(0);
    expect(draft.net).toBe(3500);
  });

  it('结算快照和复制文案保留具体休息日', () => {
    const fixedJob = job({
      cycle: 'monthly',
      rule: rule({
        payType: 'monthly',
        rate: 3500,
        standardHours: 6,
        monthlyMode: 'fixed',
        restDaysPerMonth: 5,
        otEnabled: false,
      }),
    });
    const period = periodOf('monthly', '2026-11-03', 1);
    const restDays: RestDay[] = [
      {
        id: 'rest-3',
        jobId: 'job-1',
        date: '2026-11-03',
        createdAt: '2026-11-03T12:00:00.000Z',
      },
      {
        id: 'rest-10',
        jobId: 'job-1',
        date: '2026-11-10',
        createdAt: '2026-11-10T12:00:00.000Z',
      },
    ];
    const draft = buildSettlementDraft(
      fixedJob,
      [entry({ date: '2026-11-05', hours: 6, rule: fixedJob.rule })],
      [],
      period,
      0,
      0,
      restDays,
    );
    const settlement = makeSettlement(draft, 'settlement-1', '2026-11-30T12:00:00.000Z');
    expect(settlement.restDates).toEqual(['2026-11-03', '2026-11-10']);
    expect(settlementCopyText(settlement)).toContain('休息日：11月3日、11月10日');
  });

  it('半天休息按 0.5 天计入超休扣款', () => {
    const fixedJob = job({
      cycle: 'monthly',
      rule: rule({
        payType: 'monthly',
        rate: 3500,
        standardHours: 6,
        monthlyMode: 'fixed',
        restDaysPerMonth: 5,
        overRestDeduct: true,
        otEnabled: false,
      }),
    });
    const restDays: RestDay[] = [1, 2, 3, 4, 5].map((day) => ({
      id: `rest-${day}`,
      jobId: 'job-1',
      date: `2026-11-${String(day).padStart(2, '0')}`,
      days: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
    }));
    restDays.push({
      id: 'rest-half',
      jobId: 'job-1',
      date: '2026-11-06',
      days: 0.5,
      createdAt: '2026-11-06T00:00:00.000Z',
    });
    const draft = buildSettlementDraft(
      fixedJob,
      [entry({ date: '2026-11-20', hours: 6, rule: fixedJob.rule })],
      [],
      periodOf('monthly', '2026-11-03', 1),
      0,
      0,
      restDays,
    );
    expect(draft.restDays).toBe(5.5);
    expect(draft.overRestDays).toBe(0.5);
    expect(draft.overRestDeduction).toBe(79.55);
    expect(draft.net).toBe(3420.45);
  });

  it('非整月周期只提示折算额度、不自动扣超休（PAY-02 精确值）', () => {
    const fixedJob = job({
      cycle: 'weekly',
      rule: rule({
        payType: 'monthly',
        rate: 3500,
        standardHours: 6,
        monthlyMode: 'fixed',
        restDaysPerMonth: 5,
        overRestDeduct: true,
        otEnabled: false,
      }),
    });
    // 一周 7 天、11 月 30 天 → 折算额度 5×7/30≈1.17，仅用于展示。
    const restDays: RestDay[] = [2, 3, 4].map((day) => ({
      id: `rest-${day}`,
      jobId: 'job-1',
      date: `2026-11-${String(day).padStart(2, '0')}`,
      createdAt: '2026-11-01T00:00:00.000Z',
    }));
    const draft = buildSettlementDraft(
      fixedJob,
      [entry({ date: '2026-11-05', hours: 6, rule: fixedJob.rule })],
      [],
      periodOf('weekly', '2026-11-03', 1),
      0,
      0,
      restDays,
      true,
    );
    expect(draft.overRestQuotaDays).toBe(1.17);
    expect(draft.overRestAutoDeduction).toBe(false);
    expect(draft.overRestDays).toBe(0);
    expect(draft.overRestDeduction).toBe(0);
  });

  it('全部未结金额扣除借支', () => {
    const current = state({
      entries: [entry({ date: '2026-11-03' }), entry({ date: '2026-11-04' })],
      advances: [advance({ date: '2026-11-02', amount: 100 })],
    });
    const outstanding = computeOutstanding(current);
    expect(outstanding.totals.total).toBe(400);
    expect(outstanding.net).toBe(300);
  });

  it('结算页从最早未结周期开始，并标记后续周期', () => {
    const weeklyJob = job();
    const overview = getSettlementOverview(
      state({
        jobs: [weeklyJob],
        entries: [
          entry({ date: '2026-11-03' }),
          entry({ date: '2026-11-10' }),
        ],
      }),
    );
    expect(overview.jobs).toHaveLength(1);
    expect(overview.jobs[0].period.start).toBe('2026-11-02');
    expect(overview.jobs[0].otherPeriods).toBe(1);
    expect(overview.jobs[0].draft.net).toBe(200);
  });
});

describe('工资与结算回归', () => {
  it('日薪和月薪的加班时长都不能超过总工时', () => {
    for (const payType of ['daily', 'monthly'] as const) {
      const pay = payForEntry(
        entry({
          date: '2026-11-04',
          hours: 2,
          otHours: 9,
          rule: rule({ payType, rate: 100 }),
        }),
      );
      expect(pay.otHours).toBe(2);
    }
  });

  it('总额严格由已舍入的分项相加', () => {
    const pay = payForEntry(
      entry({
        date: '2026-11-04',
        hours: 1,
        otHours: 0.5,
        rule: rule({ payType: 'hourly', rate: 0.01 }),
      }),
    );
    expect(pay.base).toBe(0.01);
    expect(pay.otPay).toBe(0.01);
    expect(pay.total).toBe(0.02);
  });

  it('普通汇总和月薪封顶汇总都对同岗位同日日薪只计一次基础工资', () => {
    const dailyRule = rule({ payType: 'daily', rate: 320 });
    const entries = [
      entry({
        id: 'daily-a',
        date: '2026-11-04',
        hours: 4,
        otHours: 1,
        bonus: 10,
        deduction: 5,
        rule: dailyRule,
      }),
      entry({
        id: 'daily-b',
        date: '2026-11-04',
        hours: 4,
        otHours: 1,
        bonus: 20,
        rule: dailyRule,
      }),
    ];
    for (const totals of [sumEntries(entries), sumEntriesCapped(entries)]) {
      expect(totals.base).toBe(320);
      expect(totals.hours).toBe(8);
      expect(totals.otHours).toBe(2);
      expect(totals.otPay).toBe(120);
      expect(totals.bonus).toBe(30);
      expect(totals.deduction).toBe(5);
      expect(totals.total).toBe(465);
      expect(totals.days).toBe(1);
    }
    const series = dailySeries(entries, '2026-11-04', '2026-11-04');
    expect(series[0].earnings).toBe(465);
    expect(series[0].hours).toBe(8);
  });

  it('固定月薪在周结和日结周期按去重出勤天数折算并封顶', () => {
    const fixedRule = rule({
      payType: 'monthly',
      rate: 3500,
      expectedDays: 22,
      monthlyMode: 'fixed',
      otEnabled: false,
    });
    const weeklyDraft = buildSettlementDraft(
      job({ cycle: 'weekly', rule: fixedRule }),
      [
        entry({ id: 'fixed-a', date: '2026-11-03', rule: fixedRule }),
        entry({ id: 'fixed-a-split', date: '2026-11-03', rule: fixedRule }),
        entry({ id: 'fixed-b', date: '2026-11-04', rule: fixedRule }),
      ],
      [],
      periodOf('weekly', '2026-11-04', 1),
    );
    expect(weeklyDraft.days).toBe(2);
    expect(weeklyDraft.base).toBe(318.18);

    const dailyDraft = buildSettlementDraft(
      job({ cycle: 'daily', rule: fixedRule }),
      [entry({ date: '2026-11-04', rule: fixedRule })],
      [],
      periodOf('daily', '2026-11-04', 1),
    );
    // B01：结算是累计封顶——日结一期 1 天照发 3500/22=159.09，不再按 1/30 压成 116.67。
    expect(dailyDraft.base).toBe(159.09);

    const partialMonth = {
      ...periodOf('monthly', '2026-11-04', 1),
      end: '2026-11-25',
    };
    const cappedDraft = buildSettlementDraft(
      job({ cycle: 'monthly', rule: fixedRule }),
      Array.from({ length: 23 }, (_, index) =>
        entry({
          date: `2026-11-${String(index + 1).padStart(2, '0')}`,
          rule: fixedRule,
        }),
      ),
      [],
      partialMonth,
    );
    // B01：非整月周期同样按累计封顶——该月尚无已结算期，封顶仍是整月 3500；
    // 23 天 raw 3659.09 被压到 3500，capAdjustment 记录超出部分。
    expect(cappedDraft.base).toBe(3500);
    expect(cappedDraft.capAdjustment).toBeGreaterThan(0);
  });

  it('超休沿用当前开关，默认扣款日薪使用历史工记规则', () => {
    const entryRule = rule({
      payType: 'monthly',
      rate: 2200,
      expectedDays: 22,
      monthlyMode: 'fixed',
      restDaysPerMonth: 1,
      overRestDeduct: true,
      overRestDailyRate: 100,
      otEnabled: false,
    });
    const currentRule = rule({
      payType: 'monthly',
      rate: 9999,
      monthlyMode: 'fixed',
      restDaysPerMonth: 1,
      overRestDeduct: true,
      overRestDailyRate: 0,
      otEnabled: false,
    });
    const fixedJob = job({ cycle: 'monthly', rule: currentRule });
    const restDays: RestDay[] = ['2026-11-01', '2026-11-02'].map((date, index) => ({
      id: `policy-rest-${index}`,
      jobId: fixedJob.id,
      date,
      createdAt: `${date}T12:00:00.000Z`,
    }));
    const draft = buildSettlementDraft(
      fixedJob,
      [entry({ date: '2026-11-03', rule: entryRule })],
      [],
      periodOf('monthly', '2026-11-03', 1),
      0,
      0,
      restDays,
    );
    expect(draft.base).toBe(2200);
    expect(draft.overRestDays).toBe(1);
    expect(draft.overRestDeduction).toBe(100);
    expect(draft.net).toBe(2100);
  });

  it('连续两次原子结算只生成一张结算并保持双向引用一致', () => {
    const initial = state({
      entries: [entry({ id: 'atomic-entry', date: '2026-11-03' })],
      advances: [advance({ id: 'atomic-advance', date: '2026-11-02', amount: 50 })],
    });
    const input = {
      jobId: 'job-1',
      period: periodOf('weekly', '2026-11-03', 1),
      extraBonus: 0,
      extraDeduction: 0,
      settlementId: 'settlement-atomic-1',
      createdAt: '2026-11-08T12:00:00.000Z',
    };
    const first = commitSettlement(initial, input);
    expect(first).not.toBeNull();
    if (!first) return;

    const second = commitSettlement(first.state, {
      ...input,
      settlementId: 'settlement-atomic-2',
    });
    expect(second).toBeNull();
    expect(first.state.settlements).toHaveLength(1);

    const settlement = first.state.settlements[0];
    expect(settlement.id).toBe('settlement-atomic-1');
    expect(settlement.entryIds).toEqual(['atomic-entry']);
    expect(settlement.advanceIds).toEqual(['atomic-advance']);
    expect(first.state.entries[0].settlementId).toBe(settlement.id);
    expect(first.state.advances[0].settlementId).toBe(settlement.id);
    expect(initial.entries[0].settlementId).toBeUndefined();
    expect(initial.advances[0].settlementId).toBeUndefined();
  });
});

describe('PAY-01 / 02 / 05 / 09 / 10 / 12 计薪口径回归', () => {
  const fixedRule = rule({
    payType: 'monthly',
    rate: 3500,
    expectedDays: 22,
    monthlyMode: 'fixed',
    otEnabled: false,
  });
  const novemberEntries = (days: number, patch: Partial<Entry> = {}): Entry[] =>
    Array.from({ length: days }, (_, index) =>
      entry({
        id: `nov-${index + 1}`,
        date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        hours: 6,
        rule: fixedRule,
        ...patch,
      }),
    );

  it('固定月薪周结 30 天全勤：多期合计不超过整月月薪 3500（B01 累计封顶）', () => {
    const weeklyJob = job({ cycle: 'weekly', rule: fixedRule });
    const entries = novemberEntries(30);
    const periods = new Map<string, ReturnType<typeof periodOf>>();
    for (const item of entries) {
      const period = periodOf('weekly', item.date, 1);
      periods.set(period.key, period);
    }
    // 按真实结算顺序逐期提交：每期锁定工记后，后续期只能拿同一自然月的剩余额度。
    let state = makeState({ jobs: [weeklyJob], entries });
    let total = 0;
    let index = 0;
    for (const period of periods.values()) {
      const committed = commitSettlement(state, {
        jobId: weeklyJob.id,
        period,
        extraBonus: 0,
        extraDeduction: 0,
        settlementId: `week-settlement-${index++}`,
        createdAt: '2026-12-01T00:00:00.000Z',
      });
      if (!committed) continue;
      total += committed.settlement.base;
      state = committed.state;
    }
    // 累计封顶：30 天 x 3500/22 的 raw 合计 4772.74，各期合计被压回整月 3500。
    // 每期独立 round2 会带来分币级漂移（本算式 1 分），不应超过 5 分。
    const sum = round2(total);
    expect(sum).toBeGreaterThanOrEqual(3499.95);
    expect(sum).toBeLessThanOrEqual(3500.05);
    // 对照：同一批工记按整月结算仍是 3500。
    const monthlyJob = job({ cycle: 'monthly', rule: fixedRule });
    const monthlyDraft = buildSettlementDraft(
      monthlyJob,
      entries,
      [],
      periodOf('monthly', '2026-11-15', 1),
    );
    expect(monthlyDraft.base).toBe(3500);
  });

  it('月休 5 天分三周休：周结各期超休扣款均为 0（修复前合计 264.10）', () => {
    const weeklyJob = job({
      cycle: 'weekly',
      rule: { ...fixedRule, restDaysPerMonth: 5, overRestDeduct: true },
    });
    const entries: Entry[] = [
      entry({ id: 'w1-1', date: '2026-11-05', hours: 6, rule: weeklyJob.rule }),
      entry({ id: 'w1-2', date: '2026-11-06', hours: 6, rule: weeklyJob.rule }),
      entry({ id: 'w2-1', date: '2026-11-12', hours: 6, rule: weeklyJob.rule }),
      entry({ id: 'w2-2', date: '2026-11-13', hours: 6, rule: weeklyJob.rule }),
      entry({ id: 'w3-1', date: '2026-11-19', hours: 6, rule: weeklyJob.rule }),
    ];
    const restDays: RestDay[] = ['2026-11-03', '2026-11-04', '2026-11-10', '2026-11-11', '2026-11-17'].map(
      (date, index) => ({
        id: `pay02-rest-${index}`,
        jobId: weeklyJob.id,
        date,
        createdAt: `${date}T12:00:00.000Z`,
      }),
    );
    const drafts = ['2026-11-04', '2026-11-11', '2026-11-18'].map((anchor) =>
      buildSettlementDraft(
        weeklyJob,
        entries,
        [],
        periodOf('weekly', anchor, 1),
        0,
        0,
        restDays,
        true,
      ),
    );
    expect(drafts.map((draft) => draft.overRestDays)).toEqual([0, 0, 0]);
    expect(drafts.map((draft) => draft.overRestDeduction)).toEqual([0, 0, 0]);
    expect(drafts.every((draft) => draft.overRestAutoDeduction === false)).toBe(true);

    // 整月周期仍按原口径扣：休 6 天、额度 5 天 → 超休 1 天 = 3500/22 = 159.09。
    const monthlyJob = job({
      cycle: 'monthly',
      rule: { ...fixedRule, restDaysPerMonth: 5, overRestDeduct: true },
    });
    const monthlyRest: RestDay[] = Array.from({ length: 6 }, (_, index) => ({
      id: `monthly-rest-${index}`,
      jobId: monthlyJob.id,
      date: `2026-11-${String(index + 1).padStart(2, '0')}`,
      createdAt: '2026-11-01T12:00:00.000Z',
    }));
    const monthlyDraft = buildSettlementDraft(
      monthlyJob,
      [entry({ id: 'monthly-work', date: '2026-11-20', hours: 6, rule: monthlyJob.rule })],
      [],
      periodOf('monthly', '2026-11-15', 1),
      0,
      0,
      monthlyRest,
      true,
    );
    expect(monthlyDraft.overRestAutoDeduction).toBe(true);
    expect(monthlyDraft.overRestDays).toBe(1);
    expect(monthlyDraft.overRestDeduction).toBe(159.09);
  });

  it('超休扣款先乘后舍入：0.0667 天扣 10.61 而不是 11.14（PAY-09）', () => {
    const fractionalQuotaJob = job({
      cycle: 'monthly',
      rule: {
        ...fixedRule,
        restDaysPerMonth: 4.9333,
        overRestDeduct: true,
      },
    });
    const restDays: RestDay[] = Array.from({ length: 5 }, (_, index) => ({
      id: `fraction-rest-${index}`,
      jobId: fractionalQuotaJob.id,
      date: `2026-11-0${index + 1}`,
      createdAt: '2026-11-01T12:00:00.000Z',
    }));
    const draft = buildSettlementDraft(
      fractionalQuotaJob,
      [entry({ id: 'fraction-work', date: '2026-11-20', hours: 6, rule: fractionalQuotaJob.rule })],
      [],
      periodOf('monthly', '2026-11-15', 1),
      0,
      0,
      restDays,
      true,
    );
    // 展示天数按分舍入成 0.07；扣款用未舍入的 0.0667 天 × 159.09 = 10.61。
    expect(draft.overRestDays).toBe(0.07);
    expect(draft.overRestDeduction).toBe(10.61);
  });

  it('createdAt 并列时按 id 字典序取最新快照，与入参顺序无关（PAY-10）', () => {
    const dailyRule = rule({ payType: 'daily', rate: 300, otEnabled: false });
    const raisedRule = { ...dailyRule, rate: 320 };
    const older = entry({
      id: 'tie-a',
      date: '2026-11-04',
      hours: 4,
      rule: dailyRule,
      createdAt: '2026-11-04T12:00:00.000Z',
    });
    const newer = entry({
      id: 'tie-b',
      date: '2026-11-04',
      hours: 4,
      rule: raisedRule,
      createdAt: '2026-11-04T12:00:00.000Z',
    });
    expect(sumEntriesCapped([older, newer]).base).toBe(320);
    expect(sumEntriesCapped([newer, older]).base).toBe(320);
    expect(dailySeries([older, newer], '2026-11-04', '2026-11-04')[0].earnings).toBe(320);
    expect(dailySeries([newer, older], '2026-11-04', '2026-11-04')[0].earnings).toBe(320);
  });

  it('孤儿工记按自然月各自封顶，跨月不共享一个月薪额度（PAY-12）', () => {
    const orphanRule = { ...fixedRule };
    const entries = ['2026-10-03', '2026-10-04', '2026-11-03', '2026-11-04'].map(
      (date, index) =>
        entry({
          id: `orphan-${index}`,
          jobId: 'job-gone',
          date,
          hours: 6,
          rule: orphanRule,
        }),
    );
    const outstanding = computeOutstanding(state({ jobs: [], entries }));
    // 每个自然月各按整月口径 3500，合计 7000；不会因为整本汇总少算一个月。
    expect(outstanding.net).toBe(7000);
    expect(outstanding.totals.days).toBe(4);
  });

  it('封顶后按日分摊合计等于整月封顶总额（PAY-05 同源 helper）', () => {
    const entries = novemberEntries(25);
    const period = periodOf('monthly', '2026-11-15', 1);
    const shares = dailyBaseSeries(entries, period);
    expect(round2(shares.reduce((sum, share) => sum + share.base, 0))).toBe(
      sumEntriesCapped(entries, period).base,
    );
    const series = dailySeries(entries, period.start, period.end);
    expect(round2(series.reduce((sum, point) => sum + point.earnings, 0))).toBe(
      sumEntriesCapped(entries, period).total,
    );
  });

  it('结算周期改为累计封顶后，与展示窗口的周期占比口径分离', () => {
    const week = periodOf('weekly', '2026-11-04', 1);
    const entries = ['02', '03', '04', '05', '06', '07', '08'].map((day, index) =>
      entry({
        id: `week-${index}`,
        date: `2026-11-${day}`,
        hours: 6,
        rule: fixedRule,
      }),
    );
    const shares = dailyBaseSeries(entries, week, { periodShareCap: true });
    // 展示窗口仍按「周期占当月天数」估算：7 天 raw = 1113.64，封顶 = 3500×7/30 = 816.67。
    expect(round2(shares.reduce((sum, share) => sum + share.base, 0))).toBe(816.67);
    // B01：实际结算走累计封顶——该月此前没有已结算期时，本期应发整周 raw 1113.64，
    // 不再被日历天占比压到 816.67；同月后续各期只能拿剩余额度。
    const draft = buildSettlementDraft(
      job({ cycle: 'weekly', rule: fixedRule }),
      entries,
      [],
      week,
    );
    expect(draft.base).toBe(1113.64);
  });
});

describe('B02 / B03 回归（第三轮审计）', () => {
  const monthlyFixed = rule({
    payType: 'monthly',
    rate: 3500,
    expectedDays: 22,
    monthlyMode: 'fixed',
    otEnabled: false,
  });

  it('B02：超休额度取工记快照，结算前改岗位设置不会追溯多扣', () => {
    const snapshot = { ...monthlyFixed, restDaysPerMonth: 5, overRestDeduct: true };
    const changed = { ...snapshot, restDaysPerMonth: 3 };
    const target = job({ id: 'job-1', cycle: 'monthly', rule: changed });
    const entries = [entry({ id: 'snap-1', date: '2026-11-03', rule: snapshot })];
    const restDays: RestDay[] = Array.from({ length: 6 }, (_, index) => ({
      id: `rest-${index}`,
      jobId: target.id,
      date: `2026-11-${String(index + 3).padStart(2, '0')}`,
      days: 1,
      createdAt: '2026-11-03T00:00:00.000Z',
    }));
    const draft = buildSettlementDraft(
      target,
      entries,
      [],
      periodOf('monthly', '2026-11-15', 1),
      0,
      0,
      restDays,
      true,
    );
    // 工记快照额度 5 天、休 6 天 → 超休 1 天；若取当前设置的 3 天会错算成 3 天。
    expect(draft.overRestDays).toBe(1);
  });

  it('B01：未结合计按累计封顶逐期试算，不因每期都拿满月薪而高估', () => {
    const weeklyJob = job({ id: 'job-1', cycle: 'weekly', rule: monthlyFixed });
    const entries = Array.from({ length: 30 }, (_, index) =>
      entry({
        id: `out-${index + 1}`,
        date: `2026-11-${String(index + 1).padStart(2, '0')}`,
        hours: 6,
        rule: monthlyFixed,
      }),
    );
    const outstanding = computeOutstanding(makeState({ jobs: [weeklyJob], entries }));
    // 30 天 raw 4772.74，累计封顶后未结合计应回到整月 3500（±分币舍入）。
    expect(round2(outstanding.net)).toBeGreaterThanOrEqual(3499.95);
    expect(round2(outstanding.net)).toBeLessThanOrEqual(3500.05);
  });

  it('B03：借支大于应发时超出部分结转下期，而不是随结算一笔勾销', () => {
    const target = job({ id: 'job-1', cycle: 'weekly', rule: monthlyFixed });
    const entries = [entry({ id: 'b03-1', date: '2026-11-02', hours: 1, rule: monthlyFixed })];
    const advances: Advance[] = [
      {
        id: 'adv-1',
        jobId: target.id,
        date: '2026-11-02',
        amount: 1000,
        createdAt: '2026-11-02T00:00:00.000Z',
      },
    ];
    const first = commitSettlement(makeState({ jobs: [target], entries, advances }), {
      jobId: target.id,
      period: periodOf('weekly', '2026-11-02', 1),
      extraBonus: 0,
      extraDeduction: 0,
      settlementId: 'b03-s1',
      createdAt: '2026-11-08T00:00:00.000Z',
    });
    expect(first).not.toBeNull();
    // 应发 3500/22=159.09，借支 1000 → 净额 -840.91。
    expect(first!.settlement.net).toBe(-840.91);
    const carry = first!.state.advances.find((item) => item.id === 'carry-b03-s1');
    expect(carry?.amount).toBe(840.91);
    expect(carry?.settlementId).toBeUndefined();

    // 下一期只剩 159.09 可发，必须先把上期结转的 840.91 抵扣掉。
    const decEntry = entry({ id: 'b03-2', date: '2026-12-02', hours: 1, rule: monthlyFixed });
    const second = commitSettlement(
      { ...first!.state, entries: [...first!.state.entries, decEntry] },
      {
        jobId: target.id,
        period: periodOf('weekly', '2026-12-02', 1),
        extraBonus: 0,
        extraDeduction: 0,
        settlementId: 'b03-s2',
        createdAt: '2026-11-15T00:00:00.000Z',
      },
    );
    expect(second!.settlement.advanceTotal).toBe(840.91);
  });
});

