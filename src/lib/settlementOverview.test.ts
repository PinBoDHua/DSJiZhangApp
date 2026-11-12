import { describe, expect, it } from 'vitest';
import type { RestDay } from '../types';
import {
  buildSettlementDraft,
  commitSettlement,
  computeOutstanding,
  getSettlementOverview,
  sumEntries,
  sumEntriesCapped,
  summarizeUnsettledJob,
} from './settlement';
import { periodOf } from './date';
import { makeAdvance, makeEntry, makeJob, makeRestDay, makeState } from './testFixtures';
import type { PayRule } from '../types';

function fixedMonthlyRule(patch: Partial<PayRule> = {}): PayRule {
  return {
    payType: 'monthly',
    rate: 3500,
    standardHours: 8,
    expectedDays: 22,
    monthlyMode: 'fixed',
    restDaysPerMonth: 0,
    restPolicy: 'quota',
    overRestDeduct: false,
    overRestDailyRate: 0,
    unitLabel: '件',
    otEnabled: false,
    weekdayOT: 1.5,
    weekendOT: 2,
    holidayOT: 3,
    ...patch,
  };
}

function restDaysFor(jobId: string, dates: string[]): RestDay[] {
  return dates.map((date, index) =>
    makeRestDay({ id: `rest-${index}`, jobId, date }),
  );
}

describe('未结金额与结算预览口径', () => {
  it('结算列表的「本期应结」包含超休扣款，与核对结算页一致', () => {
    const rule = fixedMonthlyRule({
      restDaysPerMonth: 5,
      overRestDeduct: true,
    });
    const job = makeJob({ id: 'job-fixed', cycle: 'monthly', rule });
    const entry = makeEntry({ id: 'fixed-entry', jobId: job.id, date: '2026-11-03', rule });
    // 8 天休息，超出 5 天额度 3 天；日扣 = 3500 / 22 = 159.09
    const restDays = restDaysFor(
      job.id,
      ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'],
    );
    const state = makeState({ jobs: [job], entries: [entry], restDays });

    // 核对结算页实际使用的口径（带休息天数）
    const detail = buildSettlementDraft(
      job,
      state.entries,
      state.advances,
      periodOf('monthly', '2026-11-03', 1),
      0,
      0,
      state.restDays,
      true,
    );
    expect(detail.base).toBe(3500);
    expect(detail.overRestDays).toBe(3);
    expect(detail.overRestDeduction).toBe(477.27);
    expect(detail.net).toBe(3022.73);

    const overview = getSettlementOverview(state);
    expect(overview.jobs).toHaveLength(1);
    expect(overview.jobs[0].draft.net).toBe(3022.73);
    expect(overview.jobs[0].outstanding).toBe(3022.73);
    expect(overview.outstanding).toBe(3022.73);
    expect(computeOutstanding(state).net).toBe(3022.73);
  });

  it('固定月薪按周结时未结合计按周期折算，不能按整自然月发整月', () => {
    const rule = fixedMonthlyRule();
    const job = makeJob({ id: 'job-weekly-fixed', cycle: 'weekly', rule });
    const weekOne = makeEntry({
      id: 'weekly-1',
      jobId: job.id,
      date: '2026-11-03',
      rule,
    });
    const weekTwo = makeEntry({
      id: 'weekly-2',
      jobId: job.id,
      date: '2026-11-04',
      rule,
    });
    const state = makeState({ jobs: [job], entries: [weekOne, weekTwo] });

    const summary = summarizeUnsettledJob(state, job);
    // 2 个出勤日 × (3500 / 22) = 318.18，而不是整月 3500
    expect(summary.total).toBe(318.18);
    expect(summary.periodCount).toBe(1);

    const overview = getSettlementOverview(state);
    expect(overview.jobs[0].draft.base).toBe(318.18);
    expect(overview.jobs[0].draft.net).toBe(318.18);
    expect(overview.jobs[0].outstanding).toBe(318.18);
    expect(overview.outstanding).toBe(318.18);
    expect(computeOutstanding(state).net).toBe(318.18);
  });

  it('跨多个周结周期的固定月薪逐期折算后汇总', () => {
    const rule = fixedMonthlyRule();
    const job = makeJob({ id: 'job-multi-week', cycle: 'weekly', rule });
    const entries = [
      makeEntry({ id: 'mw-1', jobId: job.id, date: '2026-11-03', rule }),
      makeEntry({ id: 'mw-2', jobId: job.id, date: '2026-11-10', rule }),
    ];
    const state = makeState({ jobs: [job], entries });
    const summary = summarizeUnsettledJob(state, job);
    expect(summary.periodCount).toBe(2);
    // 每期 1 天 = 159.09，两期合计 318.18
    expect(summary.total).toBe(318.18);
    const overview = getSettlementOverview(state);
    expect(overview.jobs[0].otherPeriods).toBe(1);
    expect(overview.jobs[0].draft.net).toBe(159.09);
    expect(overview.jobs[0].outstanding).toBe(318.18);
  });

  it('结算列表预览与提交后的结算单金额一致（含超休）', () => {
    const rule = fixedMonthlyRule({ restDaysPerMonth: 5, overRestDeduct: true });
    const job = makeJob({ id: 'job-commit', cycle: 'monthly', rule });
    const entry = makeEntry({ id: 'commit-entry', jobId: job.id, date: '2026-11-03', rule });
    const restDays = restDaysFor(job.id, [
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
    const state = makeState({ jobs: [job], entries: [entry], restDays });
    const previewNet = getSettlementOverview(state).jobs[0].draft.net;

    const committed = commitSettlement(state, {
      jobId: job.id,
      period: periodOf('monthly', entry.date, 1),
      extraBonus: 0,
      extraDeduction: 0,
      overRestEnabled: true,
      settlementId: 'settlement-preview',
      createdAt: '2026-11-30T12:00:00.000Z',
    });
    expect(committed).not.toBeNull();
    expect(committed?.settlement.net).toBe(previewNet);
  });

  it('有未结借支时列表「本期应结」与提交结算金额一致', () => {
    const job = makeJob({ id: 'job-advance', cycle: 'weekly' });
    const entries = [
      makeEntry({ id: 'adv-a', jobId: job.id, date: '2026-11-03' }),
      makeEntry({ id: 'adv-b', jobId: job.id, date: '2026-11-04' }),
    ];
    const advance = makeAdvance({ id: 'adv-1', jobId: job.id, date: '2026-11-02', amount: 100 });
    const state = makeState({ jobs: [job], entries, advances: [advance] });

    const overview = getSettlementOverview(state);
    expect(overview.jobs[0].draft.advanceTotal).toBe(100);
    expect(overview.jobs[0].draft.net).toBe(300);
    expect(overview.jobs[0].outstanding).toBe(300);
    expect(computeOutstanding(state).net).toBe(300);

    const committed = commitSettlement(state, {
      jobId: job.id,
      period: periodOf('weekly', '2026-11-03', 1),
      extraBonus: 0,
      extraDeduction: 0,
      settlementId: 'settlement-advance',
      createdAt: '2026-11-08T12:00:00.000Z',
    });
    expect(committed?.settlement.net).toBe(overview.jobs[0].draft.net);
  });

  it('同日多段日薪按 createdAt 最新快照计一次，与入参顺序无关', () => {
    const oldRule: PayRule = {
      ...makeJob().rule,
      payType: 'daily',
      rate: 300,
      otEnabled: false,
    };
    const newRule: PayRule = { ...oldRule, rate: 320 };
    const job = makeJob({ id: 'job-daily', cycle: 'weekly', rule: newRule });
    const older = makeEntry({
      id: 'daily-old',
      jobId: job.id,
      date: '2026-11-03',
      hours: 4,
      rule: oldRule,
      createdAt: '2026-11-03T09:00:00.000Z',
    });
    const newer = makeEntry({
      id: 'daily-new',
      jobId: job.id,
      date: '2026-11-03',
      hours: 4,
      rule: newRule,
      createdAt: '2026-11-03T13:00:00.000Z',
    });
    // 统计 / 结算 / 图表都不能因为数组顺序不同而取到不同快照。
    for (const entries of [
      [newer, older],
      [older, newer],
    ]) {
      expect(sumEntries(entries).base).toBe(320);
      expect(sumEntriesCapped(entries).base).toBe(320);
      expect(
        buildSettlementDraft(job, entries, [], periodOf('weekly', '2026-11-03', 1)).base,
      ).toBe(320);
      const state = makeState({ jobs: [job], entries });
      expect(getSettlementOverview(state).jobs[0].draft.base).toBe(320);
    }
  });
});