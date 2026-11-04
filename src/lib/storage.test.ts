import { describe, expect, it } from 'vitest';
import type { AppState, Job } from '../types';
import { buildExportPayload, createEmptyState, validateImport } from './storage';

const rule = {
  payType: 'hourly' as const,
  rate: 25,
  standardHours: 8,
  expectedDays: 22,
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
  it('导入 v0.1 备份时补齐 v0.2 默认值', () => {
    const imported = validateImport(
      JSON.stringify({ app: 'xinshi', version: 1, data: v1State }),
    );
    expect(imported.version).toBe(2);
    expect(imported.settings.theme).toBe('system');
    expect(imported.settings.reminder).toEqual({ enabled: false, time: '21:00' });
    expect(imported.activeTimer).toBeNull();
    expect(imported.jobs).toHaveLength(1);
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
    expect(imported.settings.theme).toBe('dark');
    expect(imported.settings.weekStartsOn).toBe(0);
    expect(imported.settings.reminder).toEqual({ enabled: true, time: '08:15' });
    expect(imported.activeTimer?.jobId).toBe('job-1');
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

  it('导出的备份使用 v2 并携带当前状态', () => {
    const state: AppState = {
      ...createEmptyState('导出测试'),
      jobs: [job],
      onboardingDone: true,
    };
    const payload = JSON.parse(buildExportPayload(state));
    expect(payload.app).toBe('xinshi');
    expect(payload.version).toBe(2);
    expect(payload.data.version).toBe(2);
    expect(payload.data.jobs[0].name).toBe('旧账本工作');
  });

  it('拒绝未来版本与坏 JSON', () => {
    expect(() => validateImport('{')).toThrow('文件不是有效的 JSON');
    expect(() =>
      validateImport(JSON.stringify({ app: 'xinshi', version: 3, data: v1State })),
    ).toThrow('更新版本');
  });
});
