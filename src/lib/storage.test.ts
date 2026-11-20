import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Job } from '../types';
import {
  LEGACY_STORAGE_KEYS,
  STORAGE_KEY,
  THEME_KEY,
  buildExportPayload,
  clearStoredState,
  createEmptyState,
  loadStateDetailed,
  validateImport,
} from './storage';
import { LAST_BACKUP_KEY } from './backupStatus';
import { BATCH_TEMPLATE_KEY } from './batchTemplates';
import { PRIVACY_CONSENT_KEY } from './compliance';
import { PAYSLIP_OPTIONS_KEY } from './payslipOptions';
import { REMINDER_LAST_KEY } from './reminder';
import { makeAdvance, makeEntry, makeSettlement } from './testFixtures';

/** 回收站用例必须用相对时间：写死日期会在 30 天保留期过后变成时间炸弹。 */
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

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
          deletedAt: daysAgo(2),
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
      trashedJobs: [{ job: trashedJob, deletedAt: daysAgo(2) }],
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
          deletedAt: daysAgo(2),
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
        { job: { id: 'bad-trash', name: '' }, deletedAt: daysAgo(2) },
        { job: goodTrash, deletedAt: daysAgo(2) },
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

  it('拒绝伪日期并接受合法闰日', () => {
    const valid = {
      ...v1State,
      version: 7,
      entries: [makeEntry({ date: '2028-02-29' })],
    };
    expect(validateImport(JSON.stringify(valid)).entries[0].date).toBe('2028-02-29');
    for (const date of ['2026-02-31', '2026-02-29', '2026-04-31']) {
      const invalid = { ...valid, entries: [makeEntry({ date })] };
      expect(() => validateImport(JSON.stringify(invalid))).toThrow('存在无效日期');
    }
  });

  it('拒绝开始日期晚于结束日期的结算周期', () => {
    const invalid = {
      ...v1State,
      version: 7,
      settlements: [
        makeSettlement({ periodStart: '2026-11-09', periodEnd: '2026-11-02' }),
      ],
    };
    expect(() => validateImport(JSON.stringify(invalid))).toThrow('结算开始日期不能晚于结束日期');
  });
});

describe('结算引用完整性', () => {
  function linkedState() {
    const entry = makeEntry({ settlementId: 'settlement-1' });
    const advance = makeAdvance({ date: '2026-11-03', settlementId: 'settlement-1' });
    const settlement = makeSettlement({
      entryIds: [entry.id],
      advanceIds: [advance.id],
    });
    return {
      ...v1State,
      version: 7,
      jobs: [...v1State.jobs],
      entries: [entry],
      advances: [advance],
      settlements: [settlement],
    };
  }

  function importLinked(state: ReturnType<typeof linkedState>) {
    return validateImport(JSON.stringify(state), { unlockOrphans: true });
  }

  it('保留工记和借支均双向一致的合法结算', () => {
    const imported = importLinked(linkedState());
    expect(imported.entries[0].settlementId).toBe('settlement-1');
    expect(imported.advances[0].settlementId).toBe('settlement-1');
    expect(imported.settlements[0].entryIds).toEqual(['entry-1']);
    expect(imported.settlements[0].advanceIds).toEqual(['advance-1']);
  });

  it('拒绝工记和借支的单向引用，即使主动导入也不静默修复', () => {
    const entryMissingFromSettlement = linkedState();
    entryMissingFromSettlement.settlements[0].entryIds = [];
    expect(() => importLinked(entryMissingFromSettlement)).toThrow('结算单未列出已锁定的工记');

    const settlementMissingFromEntry = linkedState();
    settlementMissingFromEntry.entries[0].settlementId = undefined;
    expect(() => importLinked(settlementMissingFromEntry)).toThrow('结算单与工记存在单向引用');

    const advanceMissingFromSettlement = linkedState();
    advanceMissingFromSettlement.settlements[0].advanceIds = [];
    expect(() => importLinked(advanceMissingFromSettlement)).toThrow('结算单未列出已锁定的借支');

    const settlementMissingFromAdvance = linkedState();
    settlementMissingFromAdvance.advances[0].settlementId = undefined;
    expect(() => importLinked(settlementMissingFromAdvance)).toThrow('结算单与借支存在单向引用');
  });

  it('拒绝工记和借支跨岗位引用结算', () => {
    const otherJob = { ...job, id: 'job-2', name: '另一岗位' };
    const crossJobEntry = linkedState();
    crossJobEntry.jobs.push(otherJob);
    crossJobEntry.entries[0].jobId = otherJob.id;
    expect(() => importLinked(crossJobEntry)).toThrow('工记与结算单所属工作不一致');

    const crossJobAdvance = linkedState();
    crossJobAdvance.jobs.push(otherJob);
    crossJobAdvance.advances[0].jobId = otherJob.id;
    expect(() => importLinked(crossJobAdvance)).toThrow('借支与结算单所属工作不一致');
  });

  it('允许以前周期的借支结转到当前结算', () => {
    const carriedAdvance = linkedState();
    carriedAdvance.advances[0].date = '2026-10-15';
    expect(importLinked(carriedAdvance).advances[0].settlementId).toBe('settlement-1');
  });

  it('拒绝工记超出结算周期和晚于结算期末的借支', () => {
    const lateEntry = linkedState();
    lateEntry.entries[0].date = '2026-11-09';
    expect(() => importLinked(lateEntry)).toThrow('工记日期超出结算周期');

    const lateAdvance = linkedState();
    lateAdvance.advances[0].date = '2026-11-09';
    expect(() => importLinked(lateAdvance)).toThrow('借支日期超出结算周期');
  });
});

class MemoryStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes.push(key);
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

afterEach(() => vi.unstubAllGlobals());

describe('本机账本读取与旧键迁移', () => {
  it('读取 v7 账本不回写，避免覆盖其他标签页刚保存的状态', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      STORAGE_KEY,
      JSON.stringify({ ...createEmptyState('本机账本'), jobs: [job], onboardingDone: true }),
    );
    vi.stubGlobal('localStorage', storage);

    const result = loadStateDetailed();

    expect(result.failure).toBeNull();
    expect(result.state?.version).toBe(7);
    expect(result.state?.profile.name).toBe('本机账本');
    // 读-改-写没有 CAS：读取（含跨标签页 storage 事件）不能顺手整本回写。
    expect(storage.writes).toEqual([]);
  });

  it('v6 旧键迁移时回写 v7 并删除旧键', () => {
    const storage = new MemoryStorage();
    const legacyKey = LEGACY_STORAGE_KEYS[0];
    storage.values.set(
      legacyKey,
      JSON.stringify({ ...createEmptyState('旧账本'), version: 6, onboardingDone: true }),
    );
    vi.stubGlobal('localStorage', storage);

    const result = loadStateDetailed();

    expect(result.failure).toBeNull();
    expect(result.state?.version).toBe(7);
    expect(result.state?.profile.name).toBe('旧账本');
    const migrated = JSON.parse(storage.values.get(STORAGE_KEY) ?? 'null') as AppState;
    expect(migrated.version).toBe(7);
    expect(migrated.profile.name).toBe('旧账本');
    expect(storage.values.has(legacyKey)).toBe(false);
    expect(storage.writes.filter((key) => key === STORAGE_KEY)).toHaveLength(1);
    expect(storage.writes).not.toContain(legacyKey);
  });
});

describe('清空所有数据（A06）', () => {
  it('clearStoredState 清掉全部附属键，但保留跨标签页 epoch 键', () => {
    const storage = new MemoryStorage();
    // 未导出常量的侧键直接写真实键名：实现里漏掉或拼错时这里会立刻变红。
    const shouldClear = [
      STORAGE_KEY,
      ...LEGACY_STORAGE_KEYS,
      THEME_KEY,
      LAST_BACKUP_KEY,
      BATCH_TEMPLATE_KEY,
      PRIVACY_CONSENT_KEY,
      PAYSLIP_OPTIONS_KEY,
      REMINDER_LAST_KEY,
      'xinshi.autoBackup',
      'xinshi.autoBackupFailures',
      'xinshi.budgetAlert',
      'xinshi.snapshotDailyAt',
      'xinshi.snapshotLastError',
      'xinshi.planJobId',
    ];
    const ledgerEpochKey = 'xinshi.ledgerEpoch';
    for (const key of [...shouldClear, ledgerEpochKey]) storage.values.set(key, '1');
    vi.stubGlobal('localStorage', storage);

    clearStoredState();

    // 只剩 epoch：清空账本后 store 还要靠它广播「整包替换」，不能被一起删掉（D09）。
    expect([...storage.values.keys()]).toEqual([ledgerEpochKey]);
    for (const key of shouldClear) expect(storage.values.has(key)).toBe(false);
  });
});

describe('导入字段上限', () => {
  it('手改备份里的工时 / 数量 / 金额 / 午休被钳制到录入上限', () => {
    const oversized = makeEntry({
      id: 'entry-oversized',
      date: '2026-11-05',
      hours: 1000,
      otHours: 1000,
      quantity: 1_000_000_000,
      bonus: 1_000_000_000_000,
      deduction: 1_000_000_000_000,
      breakMinutes: 9999,
    });

    const imported = validateImport(
      JSON.stringify({
        app: 'xinshi',
        version: 7,
        data: { ...v1State, version: 7, entries: [oversized] },
      }),
    );

    const entry = imported.entries[0];
    expect(entry.hours).toBe(24);
    expect(entry.otHours).toBe(24);
    expect(entry.quantity).toBe(1_000_000);
    expect(entry.bonus).toBe(1_000_000);
    expect(entry.deduction).toBe(1_000_000);
    expect(entry.breakMinutes).toBe(1440);
  });
});

describe('休息日 ID 唯一性', () => {
  it('拒绝重复 ID 的休息日，避免取消一天连带删掉另一天', () => {
    const rest = (date: string) => ({
      id: 'rest-duplicate',
      jobId: 'job-1',
      date,
      days: 1,
      createdAt: `${date}T12:00:00.000Z`,
    });
    const duplicated = {
      ...v1State,
      version: 7,
      restDays: [rest('2026-11-03'), rest('2026-11-04')],
    };

    expect(() =>
      validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: duplicated })),
    ).toThrow('休息日数据存在重复 ID');
  });
});

function importV7(data: Record<string, unknown>, options?: Parameters<typeof validateImport>[1]) {
  return validateImport(JSON.stringify({ app: 'xinshi', version: 7, data: { ...v1State, version: 7, ...data } }), options);
}

describe('导入金额与规则上限（D05）', () => {
  it('计薪规则 / 借支 / 周期规则的上限被钳制到录入口径', () => {
    const imported = importV7({
      jobs: [
        {
          ...job,
          employer: '雇'.repeat(40),
          rule: {
            ...rule,
            rate: 1e12,
            standardHours: 999,
            expectedDays: 1e9,
            overRestDailyRate: 1e12,
            weekdayOT: 1e6,
            weekendOT: 1e6,
            holidayOT: 1e6,
          },
        },
      ],
      advances: [{ id: 'adv-huge', jobId: 'job-1', date: '2026-11-01', amount: 1e12 }],
      recurringRules: [
        {
          id: 'rule-1',
          jobId: 'job-1',
          frequency: 'weekly',
          weekdays: [1],
          startDate: '2026-11-01',
          hours: 8,
          quantity: 0,
          bonus: 1e12,
          deduction: 1e12,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    });
    expect(imported.jobs[0].rule.rate).toBe(1_000_000);
    expect(imported.jobs[0].rule.standardHours).toBe(24);
    expect(imported.jobs[0].rule.expectedDays).toBe(31);
    expect(imported.jobs[0].rule.overRestDailyRate).toBe(1_000_000);
    expect(imported.jobs[0].rule.weekdayOT).toBe(10);
    expect(imported.jobs[0].rule.weekendOT).toBe(10);
    expect(imported.jobs[0].rule.holidayOT).toBe(10);
    expect(imported.jobs[0].employer).toHaveLength(24);
    expect(imported.advances[0].amount).toBe(1_000_000);
    expect(imported.recurringRules?.[0].bonus).toBe(1_000_000);
    expect(imported.recurringRules?.[0].deduction).toBe(1_000_000);
  });

  it('结算单分项、净额与已收金额被钳制，净额允许负数方向', () => {
    const imported = importV7({
      settlements: [
        makeSettlement({
          id: 'settle-huge',
          base: 1e15,
          extraBonus: 1e15,
          extraDeduction: -1e15,
          net: 1e15,
          paidAmount: 1e15,
        }),
      ],
    });
    const settlement = imported.settlements[0];
    expect(settlement.base).toBe(1_000_000_000);
    expect(settlement.extraBonus).toBe(1_000_000_000);
    expect(settlement.extraDeduction).toBe(-1_000_000_000);
    expect(settlement.net).toBe(1_000_000_000);
    expect(settlement.paidAmount).toBe(1_000_000_000);
  });
});

describe('导入加班时长（D06）', () => {
  it('加班时长被裁到不超过总工时', () => {
    const imported = importV7({ entries: [makeEntry({ hours: 1, otHours: 24 })] });
    expect(imported.entries[0].hours).toBe(1);
    expect(imported.entries[0].otHours).toBe(1);
  });
});

describe('高版本备份拒绝（D12）', () => {
  it('字符串版本号与裸 state 的高版本都会被拒绝', () => {
    expect(() =>
      validateImport(JSON.stringify({ app: 'xinshi', version: '8', data: v1State })),
    ).toThrow('格式不正确');
    expect(() => validateImport(JSON.stringify({ ...v1State, version: 99 }))).toThrow(
      '更新版本',
    );
    expect(() => validateImport(JSON.stringify({ ...v1State, version: '9' }))).toThrow(
      '格式不正确',
    );
  });
});

describe('导入时间字段（D24）', () => {
  it('非法 createdAt / updatedAt 回退为当前时间或条目创建时间', () => {
    const imported = importV7({
      jobs: [{ ...job, createdAt: 'not-a-time' }],
      entries: [makeEntry({ createdAt: 'abc', updatedAt: 'later?' })],
    });
    expect(Number.isFinite(Date.parse(imported.jobs[0].createdAt))).toBe(true);
    expect(Number.isFinite(Date.parse(imported.entries[0].createdAt))).toBe(true);
    expect(imported.entries[0].updatedAt).toBe(imported.entries[0].createdAt);
  });
});

describe('导入照片引用（D25）', () => {
  it('重复 photoId 只保留第一条并给出提示', () => {
    const warnings: string[] = [];
    const imported = importV7(
      {
        entries: [
          makeEntry({ id: 'entry-a', date: '2026-11-05', photoId: 'photo-shared' }),
          makeEntry({ id: 'entry-b', date: '2026-11-06', photoId: 'photo-shared' }),
        ],
      },
      { onWarning: (message) => warnings.push(message) },
    );
    expect(imported.entries[0].photoId).toBe('photo-shared');
    expect(imported.entries[1].photoId).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('共用同一张照片');
  });
});

describe('导入跨集合重复 ID（D26）', () => {
  it('回收站条目与在册记录同 ID 时跳过回收站副本', () => {
    const entry = makeEntry({ id: 'entry-shared', date: '2026-11-05' });
    const sharedAdvance = makeAdvance({ id: 'advance-shared' });
    const imported = importV7({
      entries: [entry],
      advances: [sharedAdvance],
      trashedEntries: [{ entry: { ...entry, hours: 2 }, deletedAt: daysAgo(1) }],
      trashedAdvances: [{ advance: sharedAdvance, deletedAt: daysAgo(1) }],
    });
    expect(imported.trashedEntries).toHaveLength(0);
    expect(imported.trashedAdvances).toHaveLength(0);
  });
});

describe('导入字符串长度上限（D31）', () => {
  it('名称 / 备注 / 称呼按界面 maxLength 截断', () => {
    const imported = importV7({
      profile: { name: '名'.repeat(40), hideAmounts: false },
      jobs: [{ ...job, name: '岗'.repeat(40), employer: '雇'.repeat(40) }],
      entries: [makeEntry({ note: '备'.repeat(400) })],
      advances: [makeAdvance({ note: '借'.repeat(100) })],
      settlements: [makeSettlement({ note: '结'.repeat(200), jobName: '单'.repeat(40) })],
    });
    expect(imported.profile.name).toHaveLength(12);
    expect(imported.jobs[0].name).toHaveLength(20);
    expect(imported.jobs[0].employer).toHaveLength(24);
    expect(imported.entries[0].note).toHaveLength(80);
    expect(imported.advances[0].note).toHaveLength(40);
    expect(imported.settlements[0].note).toHaveLength(60);
    expect(imported.settlements[0].jobName).toHaveLength(20);
  });
});

describe('旧键迁移竞态（D32）', () => {
  it('迁移回写前发现主键已被其它标签页写入时放弃回写', () => {
    let primaryReads = 0;
    const legacyKey = LEGACY_STORAGE_KEYS[0];
    const migrated = JSON.stringify(createEmptyState('其他窗口'));
    const storage = {
      values: new Map<string, string>([
        [legacyKey, JSON.stringify({ ...createEmptyState('旧账本'), version: 6, onboardingDone: true })],
      ]),
      writes: [] as string[],
      getItem(key: string) {
        if (key === STORAGE_KEY) {
          primaryReads += 1;
          // 第一次（主键扫描）为空，回写前的复查已经能看到其它标签页完成迁移的新账。
          return primaryReads === 1 ? null : migrated;
        }
        return this.values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.writes.push(key);
        this.values.set(key, value);
      },
      removeItem(key: string) {
        this.values.delete(key);
      },
    };
    vi.stubGlobal('localStorage', storage);
    const result = loadStateDetailed();
    expect(result.failure).toBeNull();
    expect(result.state?.profile.name).toBe('旧账本');
    expect(storage.writes).toEqual([]);
    expect(storage.values.has(legacyKey)).toBe(true);
  });
});

describe('结算周期内未锁定工记（D11）', () => {
  function stateWithUnlockedInPeriod() {
    return {
      ...v1State,
      version: 7,
      jobs: [...v1State.jobs],
      entries: [makeEntry({ id: 'entry-unlocked', date: '2026-11-05' })],
      settlements: [
        makeSettlement({ id: 'settle-1', periodStart: '2026-11-02', periodEnd: '2026-11-08' }),
      ],
    };
  }

  it('主动导入时拒绝落在结算周期内却没锁定的工记', () => {
    const text = JSON.stringify(stateWithUnlockedInPeriod());
    expect(() => validateImport(text, { unlockOrphans: true, rejectUnsettledInPeriod: true })).toThrow(
      '没有锁定',
    );
    // 本机读取不开这个开关：交给账本体检提示，不能把用户锁死在恢复页。
    expect(validateImport(text).entries).toHaveLength(1);
  });
});

describe('结算单重复条目 ID（D13）', () => {
  it('同一结算单里重复列出的工记 ID 落库前去重', () => {
    const entry = makeEntry({ settlementId: 'settlement-1' });
    const settlement = makeSettlement({ id: 'settlement-1', entryIds: [entry.id, entry.id] });
    const imported = importV7({ entries: [entry], settlements: [settlement] });
    expect(imported.settlements[0].entryIds).toEqual([entry.id]);
  });
});
