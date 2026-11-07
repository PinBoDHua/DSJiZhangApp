import { describe, expect, it } from 'vitest';
import type { RecurringRule } from '../types';
import { backupFileName, buildExportPayload, validateImport } from './storage';
import { makeEntry, makeJob, makeState } from './testFixtures';

const recurringRule: RecurringRule = {
  id: 'rule-v120', jobId: 'job-1', frequency: 'weekly', weekdays: [1, 3], dayOfMonth: 1,
  startDate: '2026-11-01', hours: 8, quantity: 0, bonus: 0, deduction: 0,
  enabled: true, auto: false, createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('v1.2 可选字段兼容', () => {
  it('预算、周期规则和工记来源可完整备份往返', () => {
    const state = makeState({
      jobs: [makeJob()],
      entries: [makeEntry({ recurringRuleId: recurringRule.id })],
      recurringRules: [recurringRule],
    });
    state.settings.budget = { enabled: true, incomeTarget: 6000, hoursLimit: 200 };
    const restored = validateImport(buildExportPayload(state));
    expect(restored.settings.budget).toEqual(state.settings.budget);
    expect(restored.recurringRules).toEqual([recurringRule]);
    expect(restored.entries[0].recurringRuleId).toBe(recurringRule.id);
  });

  it('旧备份缺省预算和规则，非法时间不会进入班次或工记', () => {
    const job = { ...makeJob(), shift: { startTime: '99:99', endTime: '17:00', breakMinutes: 60 } };
    const entry = { ...makeEntry(), startTime: '25:80', endTime: 'bad' };
    const restored = validateImport(JSON.stringify(makeState({ jobs: [job], entries: [entry] })));
    expect(restored.settings.budget).toBeUndefined();
    expect(restored.recurringRules).toBeUndefined();
    expect(restored.jobs[0].shift.startTime).toBe('08:00');
    expect(restored.entries[0].startTime).toBeUndefined();
    expect(restored.entries[0].endTime).toBeUndefined();
  });

  it('拒绝重复周期规则 ID', () => {
    const state = makeState({ jobs: [makeJob()], recurringRules: [recurringRule, recurringRule] });
    expect(() => validateImport(JSON.stringify(state))).toThrow('周期记工规则存在重复 ID');
  });

  it('普通备份文件名带秒，同日连续导出不会互相覆盖', () => {
    const at = new Date(2026, 10, 7, 20, 30, 40);
    expect(backupFileName(at)).toBe('薪时备份-20261107-203040.json');
    expect(backupFileName(at, true)).toBe('薪时加密备份-20261107-203040.json');
  });
});
