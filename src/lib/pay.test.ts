import { describe, expect, it } from 'vitest';
import type { Advance, AppState, Entry, Job, PayRule, RestDay } from '../types';
import { buildSettlementDraft, computeOutstanding, getSettlementOverview, sumEntriesCapped } from './settlement';
import { payForEntry } from './pay';
import { addMonths, endOfWeek, hoursBetween, periodOf, shiftPeriod, startOfWeek } from './date';
import { formatMoney, round2 } from './money';

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
