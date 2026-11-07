import { describe, expect, it } from 'vitest';
import type { RecurringRule } from '../types';
import { materializeRecurring, nextRecurringDate, ruleMatchesDate } from './recurring';
import { makeEntry, makeJob, makeRestDay, makeSettlement, makeState } from './testFixtures';

function rule(patch: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rule-1', jobId: 'job-1', frequency: 'daily', weekdays: [], dayOfMonth: 1,
    startDate: '2026-11-01', hours: 8, quantity: 0, bonus: 0, deduction: 0,
    enabled: true, auto: true, createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z', ...patch,
  };
}

function generate(state: ReturnType<typeof makeState>, today = '2026-11-04') {
  let id = 0;
  return materializeRecurring(state, { today, createId: () => `generated-${++id}` });
}

describe('周期记工', () => {
  it('每天规则只补到昨天，并保存当前工作计薪快照', () => {
    const job = makeJob();
    const result = generate(makeState({ jobs: [job], recurringRules: [rule()] }));
    expect(result.added).toBe(3);
    expect(result.state.entries.map((entry) => entry.date).sort()).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(result.state.entries.every((entry) => entry.recurringRuleId === 'rule-1')).toBe(true);
    expect(result.state.entries[0].rule).toEqual(job.rule);
    expect(result.state.recurringRules?.[0].lastProcessedDate).toBe('2026-11-03');
  });

  it('重复执行幂等，不重复入账', () => {
    const first = generate(makeState({ jobs: [makeJob()], recurringRules: [rule()] }));
    const second = generate(first.state);
    expect(second.added).toBe(0);
    expect(second.state).toBe(first.state);
  });

  it('每周只生成选中的工作日', () => {
    const state = makeState({ jobs: [makeJob()], recurringRules: [rule({ frequency: 'weekly', weekdays: [1, 3] })] });
    const result = generate(state, '2026-11-09');
    expect(result.state.entries.map((entry) => entry.date)).toEqual(['2026-11-04', '2026-11-02']);
  });

  it('每月 31 日在小月落到月末', () => {
    const monthly = rule({ frequency: 'monthly', dayOfMonth: 31, startDate: '2026-02-01' });
    expect(ruleMatchesDate(monthly, '2026-02-28')).toBe(true);
    expect(ruleMatchesDate(monthly, '2026-04-30')).toBe(true);
    expect(ruleMatchesDate(monthly, '2026-04-29')).toBe(false);
    expect(nextRecurringDate(monthly, '2026-03-01')).toBe('2026-03-31');
  });

  it('自动模式只处理明确开启自动补记的规则', () => {
    const state = makeState({ jobs: [makeJob()], recurringRules: [rule({ auto: false })] });
    const result = materializeRecurring(state, { today: '2026-11-04', automaticOnly: true });
    expect(result.added).toBe(0);
    expect(result.state).toBe(state);
  });

  it('已有同岗位同工记、休息或已结算时跳过且不覆盖', () => {
    const existing = makeEntry({ id: 'manual', date: '2026-11-01' });
    const state = makeState({
      jobs: [makeJob()],
      entries: [existing],
      restDays: [makeRestDay({ date: '2026-11-02' })],
      settlements: [makeSettlement({ periodStart: '2026-11-03', periodEnd: '2026-11-03' })],
      recurringRules: [rule()],
    });
    const result = generate(state);
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(3);
    expect(result.state.entries).toEqual([existing]);
  });

  it('跨岗位合计超过 24 小时时跳过', () => {
    const state = makeState({
      jobs: [makeJob()],
      entries: [makeEntry({ id: 'other', jobId: 'other-job', date: '2026-11-01', hours: 20 })],
      recurringRules: [rule()],
    });
    const result = generate(state, '2026-11-02');
    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('手动模式可包含今天，但默认不包含', () => {
    const state = makeState({ jobs: [makeJob()], recurringRules: [rule({ startDate: '2026-11-04' })] });
    expect(generate(state).added).toBe(0);
    expect(materializeRecurring(state, { today: '2026-11-04', includeToday: true }).added).toBe(1);
  });

  it('开始日期很早时只补最近 120 天，不会一次生成上千条', () => {
    const state = makeState({
      jobs: [makeJob()],
      recurringRules: [rule({ startDate: '2020-01-01' })],
    });
    const started = Date.now();
    const result = generate(state, '2026-11-04');
    expect(result.added).toBe(120);
    expect(result.truncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
    const dates = result.state.entries.map((entry) => entry.date).sort();
    expect(dates[0]).toBe('2026-07-07');
    expect(dates[dates.length - 1]).toBe('2026-11-03');
    expect(result.state.recurringRules?.[0].lastProcessedDate).toBe('2026-11-03');
  });

  it('长时间没打开、游标太旧时同样只补最近 120 天', () => {
    const state = makeState({
      jobs: [makeJob()],
      recurringRules: [
        rule({ startDate: '2025-12-01', lastProcessedDate: '2025-12-31' }),
      ],
    });
    const result = generate(state, '2026-11-04');
    expect(result.added).toBe(120);
    expect(result.truncated).toBe(true);
    expect(result.state.recurringRules?.[0].lastProcessedDate).toBe('2026-11-03');
  });

  it('回溯窗口可通过参数收窄，正常规则不标记截断', () => {
    const recent = makeState({
      jobs: [makeJob()],
      recurringRules: [rule({ startDate: '2026-10-25' })],
    });
    const result = generate(recent, '2026-11-04');
    expect(result.added).toBe(10);
    expect(result.truncated).toBe(false);

    const narrow = materializeRecurring(
      makeState({ jobs: [makeJob()], recurringRules: [rule({ startDate: '2026-10-25' })] }),
      { today: '2026-11-04', backfillDays: 3, createId: (() => { let id = 0; return () => `gen-${++id}`; })() },
    );
    expect(narrow.added).toBe(3);
    expect(narrow.truncated).toBe(true);
  });
});
