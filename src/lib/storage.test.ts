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
    expect(imported.version).toBe(7);
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
    expect(imported.version).toBe(7);
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
    expect(imported.version).toBe(7);
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
    expect(imported.version).toBe(7);
    expect(imported.jobs[0].rule.overRestDeduct).toBe(false);
    expect(imported.jobs[0].rule.overRestDailyRate).toBe(0);
    expect(imported.jobs[0].payday).toBeUndefined();
    expect(imported.settlements[0].paymentStatus).toBe('unpaid');
    expect(imported.settlements[0].paidAmount).toBe(0);
  });

  it('v0.5 数据补齐回收站，并保留已删除工作', () => {
    const trashedJob = { ...job, id: 'trash-job-1', name: '回收站工作' };
    const v5 = {
      ...v1State,
      version: 5,
      trashedJobs: [
        {
          job: trashedJob,
          deletedAt: '2026-11-04T12:00:00.000Z',
        },
      ],
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 5, data: v5 }));
    expect(imported.version).toBe(7);
    expect(imported.trashedJobs).toHaveLength(1);
    expect(imported.trashedJobs[0].job.name).toBe('回收站工作');
  });

  it('v0.6 保留固定上班日，并清理超过 30 天的回收站', () => {
    const oldJob = { ...job, id: 'old-trash', name: '旧回收站' };
    const recentJob = { ...job, id: 'recent-trash', name: '新回收站' };
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const v6 = {
      ...v1State,
      version: 6,
      jobs: [{ ...job, workWeekdays: [1, 2, 3, 4, 5, 6] }],
      trashedJobs: [
        { job: oldJob, deletedAt: daysAgo(31) },
        { job: recentJob, deletedAt: daysAgo(2) },
      ],
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 6, data: v6 }));
    expect(imported.version).toBe(7);
    expect(imported.jobs[0].workWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(imported.trashedJobs).toHaveLength(1);
    expect(imported.trashedJobs[0].job.name).toBe('新回收站');
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

  it('导出的备份使用 v6 并携带当前状态', () => {
    const state: AppState = {
      ...createEmptyState('导出测试'),
      jobs: [job],
      onboardingDone: true,
    };
    const payload = JSON.parse(buildExportPayload(state));
    expect(payload.app).toBe('xinshi');
    expect(payload.version).toBe(7);
    expect(payload.data.version).toBe(7);
    expect(payload.data.jobs[0].name).toBe('旧账本工作');
  });

  it('保留随机休息规则和结算休息日期，旧数据默认固定额度', () => {
    const flexibleJob = {
      ...job,
      id: 'job-flex',
      rule: {
        ...rule,
        payType: 'monthly' as const,
        monthlyMode: 'fixed' as const,
        restDaysPerMonth: 0,
        restPolicy: 'flexible' as const,
      },
    };
    const v7 = {
      ...v1State,
      version: 7,
      jobs: [flexibleJob, job],
      settlements: [
        {
          id: 'settlement-rest',
          jobId: 'job-flex',
          jobName: '随机休息工作',
          cycle: 'monthly',
          periodStart: '2026-11-01',
          periodEnd: '2026-11-30',
          restDays: 2,
          restDates: ['2026-11-10', '2026-11-03', '2026-11-03'],
          base: 3500,
          otPay: 0,
          bonus: 0,
          deduction: 0,
          advanceTotal: 0,
          extraBonus: 0,
          extraDeduction: 0,
          net: 3500,
          hours: 12,
          days: 2,
          otHours: 0,
          entryIds: [],
          advanceIds: [],
          createdAt: '2026-11-30T12:00:00.000Z',
        },
      ],
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v7 }));
    expect(imported.jobs[0].rule.restPolicy).toBe('flexible');
    expect(imported.jobs[1].rule.restPolicy).toBe('quota');
    expect(imported.settlements[0].restDates).toEqual(['2026-11-03', '2026-11-10']);
  });

  it('休息日保留半天，旧数据默认整天', () => {
    const v7 = {
      ...v1State,
      version: 7,
      restDays: [
        {
          id: 'rest-old',
          jobId: 'job-1',
          date: '2026-11-03',
          createdAt: '2026-11-03T12:00:00.000Z',
        },
        {
          id: 'rest-half',
          jobId: 'job-1',
          date: '2026-11-04',
          days: 0.5,
          createdAt: '2026-11-04T12:00:00.000Z',
        },
      ],
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v7 }));
    expect(imported.restDays.find((item) => item.id === 'rest-old')?.days).toBe(1);
    expect(imported.restDays.find((item) => item.id === 'rest-half')?.days).toBe(0.5);
  });

  it('拒绝未来版本与坏 JSON', () => {
    expect(() => validateImport('{')).toThrow('文件不是有效的 JSON');
    expect(() =>
      validateImport(JSON.stringify({ app: 'xinshi', version: 8, data: v1State })),
    ).toThrow('更新版本');
  });

  it('导入 v0.9 回收站：保留工记 / 休息 / 借支，跳过失效与过期条目', () => {
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const entry = {
      id: 'trash-entry',
      jobId: 'job-1',
      date: '2026-11-05',
      breakMinutes: 0,
      hours: 8,
      quantity: 0,
      otHours: 0,
      bonus: 0,
      deduction: 0,
      holiday: false,
      rule,
      createdAt: '2026-11-05T12:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
    };
    const v7 = {
      ...v1State,
      version: 7,
      trashedEntries: [
        { entry, deletedAt: daysAgo(2) },
        { entry: { ...entry, id: 'trash-old' }, deletedAt: daysAgo(31) },
        { entry: { ...entry, id: 'trash-ghost', jobId: 'missing' }, deletedAt: daysAgo(1) },
      ],
      trashedRests: [
        {
          restDay: {
            id: 'trash-rest',
            jobId: 'job-1',
            date: '2026-11-03',
            days: 0.5,
            createdAt: '2026-11-03T12:00:00.000Z',
          },
          deletedAt: daysAgo(2),
        },
      ],
      trashedAdvances: [
        {
          advance: {
            id: 'trash-advance',
            jobId: 'job-1',
            date: '2026-11-01',
            amount: 100,
            note: '借支',
            createdAt: '2026-11-01T12:00:00.000Z',
          },
          deletedAt: daysAgo(2),
        },
      ],
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v7 }));
    expect(imported.trashedEntries).toHaveLength(1);
    expect(imported.trashedEntries[0].entry.id).toBe('trash-entry');
    expect(imported.trashedRests[0].restDay.days).toBe(0.5);
    expect(imported.trashedAdvances[0].advance.amount).toBe(100);
  });

  it('回收站记录可以指向仍在回收站里的工作', () => {
    const trashedJob = { ...job, id: 'job-trash', name: '已删工作' };
    const v7 = {
      ...v1State,
      version: 7,
      jobs: [],
      trashedJobs: [{ job: trashedJob, deletedAt: '2026-11-05T12:00:00.000Z' }],
      trashedEntries: [
        {
          entry: {
            id: 'trash-entry',
            jobId: 'job-trash',
            date: '2026-11-05',
            breakMinutes: 0,
            hours: 8,
            quantity: 0,
            otHours: 0,
            bonus: 0,
            deduction: 0,
            holiday: false,
            rule,
            createdAt: '2026-11-05T12:00:00.000Z',
            updatedAt: '2026-11-05T12:00:00.000Z',
          },
          deletedAt: '2026-11-05T12:00:00.000Z',
        },
      ],
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v7 }));
    expect(imported.trashedEntries).toHaveLength(1);
  });

  it('拒绝重复 ID 的工记，避免后续编辑删错记录', () => {
    const entry = {
      id: 'entry-duplicate',
      jobId: 'job-1',
      date: '2026-11-05',
      breakMinutes: 0,
      hours: 8,
      quantity: 0,
      otHours: 0,
      bonus: 0,
      deduction: 0,
      holiday: false,
      rule,
      createdAt: '2026-11-05T12:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
    };
    const v7 = { ...v1State, version: 7, entries: [entry, { ...entry }] };
    expect(() =>
      validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v7 })),
    ).toThrow('工记数据存在重复 ID');
  });

  it('保留工记的可选照片 ID，旧备份缺省为空', () => {
    const entry = {
      id: 'entry-photo',
      jobId: 'job-1',
      date: '2026-11-05',
      breakMinutes: 0,
      hours: 8,
      quantity: 0,
      otHours: 0,
      bonus: 0,
      deduction: 0,
      holiday: false,
      rule,
      photoId: ' photo-1 ',
      createdAt: '2026-11-05T12:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
    };
    const v7 = { ...v1State, version: 7, entries: [entry] };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v7 }));
    expect(imported.entries[0].photoId).toBe('photo-1');
    expect(
      validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v1State })).entries,
    ).toEqual([]);
  });

  it('跳过坏掉的回收站工作，不拒绝整份备份', () => {
    const goodTrash = { ...job, id: 'trash-good', name: '可恢复工作' };
    const v7 = {
      ...v1State,
      version: 7,
      trashedJobs: [
        { job: { id: 'bad-trash', name: '' }, deletedAt: '2026-11-05T12:00:00.000Z' },
        { job: goodTrash, deletedAt: '2026-11-05T12:00:00.000Z' },
      ],
    };
    const imported = validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v7 }));
    expect(imported.trashedJobs.map((item) => item.job.id)).toEqual(['trash-good']);
  });

  it('拒绝同一工作周期重叠的结算，避免重复发薪', () => {
    const baseSettlement = {
      jobId: 'job-1',
      jobName: '旧账本工作',
      cycle: 'weekly',
      periodStart: '2026-11-02',
      periodEnd: '2026-11-08',
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
      createdAt: '2026-11-08T12:00:00.000Z',
    };
    const v7 = {
      ...v1State,
      version: 7,
      settlements: [
        { ...baseSettlement, id: 'settle-1' },
        { ...baseSettlement, id: 'settle-2', periodStart: '2026-11-05', periodEnd: '2026-11-11' },
      ],
    };
    expect(() =>
      validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: v7 })),
    ).toThrow('同一工作的结算周期重叠');
  });

  it('导入时解锁指向不存在结算的工记 / 借支', () => {
    const entry = {
      id: 'entry-orphan',
      jobId: 'job-1',
      date: '2026-11-05',
      breakMinutes: 0,
      hours: 8,
      quantity: 0,
      otHours: 0,
      bonus: 0,
      deduction: 0,
      holiday: false,
      rule,
      settlementId: 'missing-settlement',
      createdAt: '2026-11-05T12:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
    };
    const advance = {
      id: 'advance-orphan',
      jobId: 'job-1',
      date: '2026-11-01',
      amount: 100,
      settlementId: 'missing-settlement',
      createdAt: '2026-11-01T12:00:00.000Z',
    };
    const v7 = { ...v1State, version: 7, entries: [entry], advances: [advance] };
    const text = JSON.stringify({ app: 'xinshi', version: 7, data: v7 });
    // 本机读取保留孤儿锁定，交给账本体检处理
    expect(validateImport(text).entries[0].settlementId).toBe('missing-settlement');
    // 主动导入备份时解锁，避免导入后永久无法编辑
    const imported = validateImport(text, { unlockOrphans: true });
    expect(imported.entries[0].settlementId).toBeUndefined();
    expect(imported.advances[0].settlementId).toBeUndefined();
  });
});
