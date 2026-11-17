import { describe, expect, it } from 'vitest';
import { nextPayday, paydayNotificationBaseId } from './paydayNotifications';

describe('发薪通知 ID', () => {
  it('只由工作 ID 决定，不受列表顺序影响', () => {
    expect(paydayNotificationBaseId('job-a')).toBe(paydayNotificationBaseId('job-a'));
    expect(paydayNotificationBaseId('job-a')).not.toBe(paydayNotificationBaseId('job-b'));
    expect(paydayNotificationBaseId('job-a')).toBeGreaterThanOrEqual(100000);
  });

  it('ID 落在 Android int32 安全范围内，1000 个岗位基本不碰撞', () => {
    const ids = new Set<number>();
    for (let index = 0; index < 1000; index += 1) {
      ids.add(paydayNotificationBaseId(`job-${index}`));
    }
    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(100000);
      // 每次排 3 条（id + 0/1/2），必须 < 2^31 - 1。
      expect(id + 2).toBeLessThan(2 ** 31 - 1);
    }
  });
});

describe('nextPayday 日期边界', () => {
  it('月末回落：2 月没有 31 日时排到 28 日', () => {
    const next = nextPayday(31, new Date(2026, 1, 1, 12, 0, 0));
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 1, 28]);
    expect(next.getHours()).toBe(9);
  });

  it('当天未到 09:00 排今天，已过 09:00 排下月', () => {
    const before = nextPayday(10, new Date(2026, 10, 10, 8, 0, 0));
    expect([before.getMonth(), before.getDate()]).toEqual([10, 10]);
    const after = nextPayday(10, new Date(2026, 10, 10, 9, 30, 0));
    expect([after.getMonth(), after.getDate()]).toEqual([11, 10]);
  });

  it('跨年：12 月已过发薪日后排到次年 1 月', () => {
    const next = nextPayday(5, new Date(2026, 11, 20, 12, 0, 0));
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2027, 0, 5]);
  });
});
