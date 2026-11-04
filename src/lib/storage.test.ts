import { describe, expect, it } from 'vitest';
import type { AppState, Job } from '../types';
import { buildExportPayload, createEmptyState, validateImport } from './storage';

const rule = {
  payType: 'hourly' as const,
  rate: 25,
  standardHours: 8,
  expectedDays: 22,
  monthlyMode: 'prorated' as const,
  restDaysPerMonth: 0,
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: true,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
};

const job: Job = {
  id: 'job-1',
  name: '旧账本工作',
  color: 'pine',
  rule,
  shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
  cycle: 'weekly',
  archived: false,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const v1State = {
  version: 1,
  profile: { name: '旧账本', hideAmounts: false },
  settings: { weekStartsOn: 1 },
  jobs: [job],
  entries: [],
  advances: [],
  settlements: [],
  onboardingDone: true,
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('存储升级', () => {
  it('导入 v0.1 备份时补齐 v0.2 / v0.3 / v0.4 默认值', () => {
    const imported = validateImport(
      JSON.stringify({ app: 'xinshi', version: 1, data: v1State }),
    );
    expect(imported.version).toBe(5);
    expect(imported.settings.theme).toBe('system');
    expect(imported.settings.reminder).toEqual({ enabled: false, time: '21:00' });
    expect(imported.activeTimer).toBeNull();
    expect(imported.jobs).toHaveLength(1);
    expect(imported.restDays).toEqual([]);
  });

  it('保留 v0.2 的主题、提醒和计时器', () => {
    const v2 = {
      ...v1State,
      version: 2,
      settings: {
        weekStartsOn: 0,
        theme: 'dark',
        reminder: { enabled: true, time: '08:15' },
      },
      activeTimer: { jobId: 'job-1', startedAt: '2026-11-04T00:00:00.000Z' },
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 2, data: v2 }));
    expect(imported.version).toBe(5);
    expect(imported.settings.theme).toBe('dark');
    expect(imported.settings.weekStartsOn).toBe(0);
    expect(imported.settings.reminder).toEqual({ enabled: true, time: '08:15' });
    expect(imported.activeTimer?.jobId).toBe('job-1');
  });

  it('v0.3 工作补齐班次 / 固定月薪默认值，并保留休息日', () => {
    const legacyJob = {
      ...job,
      shift: undefined,
      rule: { ...rule, monthlyMode: undefined, restDaysPerMonth: undefined },
    };
    const v3 = {
      ...v1State,
      version: 3,
      jobs: [legacyJob],
      restDays: [
        {
          id: 'rest-1',
          jobId: 'job-1',
          date: '2026-11-06',
          note: '月休',
          createdAt: '2026-11-06T12:00:00.000Z',
        },
      ],
    };
    const imported = validateImport(JSON.stringify(v3));
    expect(imported.version).toBe(5);
    expect(imported.jobs[0].shift).toEqual({
      startTime: '08:00',
      endTime: '17:00',
      breakMinutes: 60,
    });
    expect(imported.jobs[0].rule.monthlyMode).toBe('prorated');
    expect(imported.jobs[0].rule.restDaysPerMonth).toBe(0);
    expect(imported.restDays[0].date).toBe('2026-11-06');
  });

  it('v0.4 数据补齐超休 / 收款默认值', () => {
    const legacyJob = {
      ...job,
      rule: {
        ...rule,
        overRestDeduct: undefined,
        overRestDailyRate: undefined,
      },
      payday: undefined,
    };
    const v4 = {
      ...v1State,
      version: 4,
      jobs: [legacyJob],
      settlements: [
        {
          id: 'settlement-1',
          jobId: 'job-1',
          jobName: '旧账本工作',
          cycle: 'weekly',
          periodStart: '2026-11-03',
          periodEnd: '2026-11-09',
          base: 200,
          otPay: 0,
          bonus: 0,
          deduction: 0,
          advanceTotal: 0,
          extraBonus: 0,
          extraDeduction: 0,
          net: 200,
          hours: 8,
          days: 1,
          otHours: 0,
          entryIds: [],
          advanceIds: [],
          createdAt: '2026-11-09T12:00:00.000Z',
        },
      ],
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 4, data: v4 }));
    expect(imported.version).toBe(5);
    expect(imported.jobs[0].rule.overRestDeduct).toBe(false);
    expect(imported.jobs[0].rule.overRestDailyRate).toBe(0);
    expect(imported.jobs[0].payday).toBeUndefined();
    expect(imported.settlements[0].paymentStatus).toBe('unpaid');
    expect(imported.settlements[0].paidAmount).toBe(0);
  });

  it('旧工记补齐 quantity / unitLabel 默认值', () => {
    const legacyEntry = {
      id: 'entry-1',
      jobId: 'job-1',
      date: '2026-11-04',
      breakMinutes: 0,
      hours: 8,
      otHours: 0,
      bonus: 0,
      deduction: 0,
      holiday: false,
      rule: { ...rule, unitLabel: undefined },
      createdAt: '2026-11-04T12:00:00.000Z',
      updatedAt: '2026-11-04T12:00:00.000Z',
    };
    const v2 = {
      ...v1State,
      version: 2,
      settings: { weekStartsOn: 1, theme: 'system', reminder: { enabled: false, time: '21:00' } },
      entries: [legacyEntry],
    };
    const imported = validateImport(JSON.stringify(v2));
    expect(imported.entries[0].quantity).toBe(0);
    expect(imported.entries[0].rule.unitLabel).toBe('件');
  });

  it('计时器引用已删除或已归档的工作时丢弃', () => {
    const v2 = {
      ...v1State,
      version: 2,
      settings: { weekStartsOn: 1, theme: 'system', reminder: { enabled: false, time: '21:00' } },
      activeTimer: { jobId: 'missing', startedAt: '2026-11-04T00:00:00.000Z' },
    };
    const imported = validateImport(JSON.stringify(v2));
    expect(imported.activeTimer).toBeNull();
  });

  it('导出的备份使用 v5 并携带当前状态', () => {
    const state: AppState = {
      ...createEmptyState('导出测试'),
      jobs: [job],
      onboardingDone: true,
    };
    const payload = JSON.parse(buildExportPayload(state));
    expect(payload.app).toBe('xinshi');
    expect(payload.version).toBe(5);
    expect(payload.data.version).toBe(5);
    expect(payload.data.jobs[0].name).toBe('旧账本工作');
  });

  it('拒绝未来版本与坏 JSON', () => {
    expect(() => validateImport('{')).toThrow('文件不是有效的 JSON');
    expect(() =>
      validateImport(JSON.stringify({ app: 'xinshi', version: 6, data: v1State })),
    ).toThrow('更新版本');
  });
});
