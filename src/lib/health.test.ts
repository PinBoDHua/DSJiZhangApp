import { describe, expect, it } from 'vitest';
import type { AppState } from '../types';
import { applySafeFixes, checkLedger, healthBadgeText } from './health';
import {
  baseRule,
  makeAdvance,
  makeEntry,
  makeJob,
  makeRestDay,
  makeSettlement,
  makeState,
} from './testFixtures';

const today = '2026-11-05';
const lastBackupAt = '2026-11-05T08:00:00.000Z';

function healthyState(): AppState {
  const job = makeJob();
  const entry = makeEntry({ settlementId: 'settlement-1' });
  const settlement = makeSettlement({ entryIds: [entry.id] });
  return makeState({ jobs: [job], entries: [entry], settlements: [settlement] });
}

function codes(state: AppState, lastBackup: string | null = lastBackupAt): string[] {
  return checkLedger(state, { today, lastBackupAt: lastBackup }).issues.map(
    (issue) => issue.code,
  );
}

describe('账本体检', () => {
  it('正常账本没有严重或提醒项', () => {
    const report = checkLedger(healthyState(), { today, lastBackupAt });
    expect(report.issues).toHaveLength(0);
    expect(report.counts.critical).toBe(0);
    expect(report.counts.warning).toBe(0);
  });

  it('结算净额与分项不一致', () => {
    const state = healthyState();
    state.settlements[0].net = 199;
    expect(codes(state)).toContain('settlement-sum-mismatch');
  });

  it('结算纳入周期外的工记', () => {
    const state = healthyState();
    state.settlements[0].periodEnd = '2026-11-01';
    expect(codes(state)).toContain('settlement-entry-outside-period');
  });

  it('工记锁定在不存在的结算上，且可安全解锁', () => {
    const state = healthyState();
    state.settlements = [];
    state.entries[0].settlementId = 'missing-settlement';
    const report = checkLedger(state, { today, lastBackupAt });
    expect(report.issues.find((issue) => issue.code === 'orphan-settlement-lock')?.fixable).toBe(
      true,
    );
    const fixed = applySafeFixes(state, ['orphan-settlement-lock']);
    expect(fixed.fixed).toBe(1);
    expect(fixed.state.entries[0].settlementId).toBeUndefined();
    expect(applySafeFixes(fixed.state, ['orphan-settlement-lock']).fixed).toBe(0);
  });

  it('同一笔工记被两张结算单纳入', () => {
    const state = healthyState();
    state.settlements.push(
      makeSettlement({ id: 'settlement-2', entryIds: [state.entries[0].id] }),
    );
    expect(codes(state)).toContain('entry-multi-settled');
  });

  it('结算周期颠倒或金额异常', () => {
    const state = healthyState();
    state.settlements[0].periodStart = '2026-11-10';
    state.settlements[0].periodEnd = '2026-11-01';
    expect(codes(state)).toContain('settlement-invalid');
  });

  it('记录引用了不存在的工作', () => {
    const state = makeState({ jobs: [], entries: [makeEntry()] });
    expect(codes(state)).toContain('orphan-job');
  });

  it('结算引用的工记已丢失', () => {
    const state = makeState({
      jobs: [makeJob()],
      settlements: [makeSettlement({ entryIds: ['missing-entry'] })],
    });
    expect(codes(state)).toContain('settlement-entry-missing');
  });

  it('休息日与工记同日', () => {
    const state = makeState({
      jobs: [makeJob()],
      entries: [makeEntry({ date: '2026-11-02' })],
      restDays: [makeRestDay({ date: '2026-11-02' })],
    });
    expect(codes(state)).toContain('rest-entry-conflict');
  });

  it('同工作同日多条工记', () => {
    const state = makeState({
      jobs: [makeJob()],
      entries: [makeEntry({ id: 'entry-1' }), makeEntry({ id: 'entry-2' })],
    });
    expect(codes(state)).toContain('duplicate-entry');
  });

  it('同一天合计超过 24 小时', () => {
    const state = makeState({
      jobs: [makeJob()],
      entries: [makeEntry({ hours: 25 })],
    });
    expect(codes(state)).toContain('day-hours-over-24');
  });

  it('休息天数非法', () => {
    const state = makeState({
      jobs: [makeJob()],
      restDays: [makeRestDay({ days: 2 })],
    });
    expect(codes(state)).toContain('rest-days-invalid');
  });

  it('已收超过应发', () => {
    const state = healthyState();
    state.settlements[0].paidAmount = 300;
    state.settlements[0].paymentStatus = 'partial';
    expect(codes(state)).toContain('payment-over-net');
  });

  it('超休扣款超过固定月薪', () => {
    const job = makeJob({
      rule: { ...baseRule, payType: 'monthly', monthlyMode: 'fixed', rate: 3500 },
    });
    const settlement = makeSettlement({
      base: 3500,
      overRestDeduction: 4000,
    });
    const state = makeState({ jobs: [job], settlements: [settlement] });
    expect(codes(state)).toContain('overrest-over-salary');
  });

  it('未来工记、长期未结、空工作、备份过期作为提示', () => {
    const future = makeState({ jobs: [makeJob()], entries: [makeEntry({ date: '2026-12-01' })] });
    expect(codes(future)).toContain('future-entry');

    const stale = makeState({ jobs: [makeJob()], entries: [makeEntry({ date: '2026-08-01' })] });
    expect(codes(stale)).toContain('stale-unsettled');

    const empty = makeState({ jobs: [makeJob()] });
    expect(codes(empty)).toContain('empty-job');

    const backup = makeState({ jobs: [makeJob()], entries: [makeEntry()] });
    expect(codes(backup, null)).toContain('backup-stale');
  });

  it('徽标文案按严重程度显示', () => {
    expect(healthBadgeText(checkLedger(healthyState(), { today, lastBackupAt }))).toBe('账本正常');
    const state = healthyState();
    state.settlements[0].net = 1;
    expect(healthBadgeText(checkLedger(state, { today, lastBackupAt }))).toContain('严重');
  });

  it('借支孤儿锁定也计入安全修复', () => {
    const state = makeState({
      jobs: [makeJob()],
      advances: [makeAdvance({ settlementId: 'missing' })],
    });
    expect(codes(state)).toContain('orphan-settlement-lock');
    const fixed = applySafeFixes(state, ['orphan-settlement-lock']);
    expect(fixed.fixed).toBe(1);
    expect(fixed.state.advances[0].settlementId).toBeUndefined();
  });
});
