import type { Job } from '../types';
import { isNativeApp } from './native';

const CHANNEL_ID = 'xinshi-payday';
const PAYDAY_KIND = 'xinshi-payday';

export function paydayNotificationBaseId(jobId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < jobId.length; index += 1) {
    hash ^= jobId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  // 与工作数组顺序无关，并远离 daily / test 使用的 8100–8199。
  return 100_000 + (hash >>> 0) % 1_000_000 * 3;
}

function nextPayday(payday: number, from = new Date()): Date {
  const safeDay = Math.max(1, Math.min(31, Math.round(payday)));
  const candidate = new Date(
    from.getFullYear(),
    from.getMonth(),
    Math.min(safeDay, new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate()),
    9,
    0,
    0,
    0,
  );
  if (candidate.getTime() <= from.getTime()) {
    const nextMonth = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    candidate.setFullYear(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    candidate.setDate(
      Math.min(safeDay, new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate()),
    );
  }
  return candidate;
}

function nextOccurrences(payday: number, count = 3): Date[] {
  const result: Date[] = [];
  let cursor = new Date();
  for (let index = 0; index < count; index += 1) {
    const next = nextPayday(payday, cursor);
    result.push(next);
    cursor = new Date(next.getTime() + 24 * 60 * 60 * 1000);
  }
  return result;
}

export async function schedulePaydayNotifications(jobs: Job[]): Promise<number> {
  if (!isNativeApp()) return 0;
  const paydayJobs = jobs.filter(
    (job) => !job.archived && job.cycle === 'monthly' && job.payday,
  );

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    if (paydayJobs.length === 0) {
      try {
        const pending = await LocalNotifications.getPending();
        const stale = pending.notifications
          .filter((item) => item.extra?.kind === PAYDAY_KIND)
          .map((item) => ({ id: item.id }));
        if (stale.length > 0) {
          await LocalNotifications.cancel({ notifications: stale });
        }
      } catch {
        // 没有通知权限时也没有可清理的待发通知。
      }
      return 0;
    }
    const permission = await LocalNotifications.checkPermissions();
    // 启动同步绝不能自行弹权限框；权限只在用户主动开启通知时申请。
    if (permission.display !== 'granted') return 0;

    try {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: '发薪提醒',
        description: '发薪日当天提醒核对结算和收款',
        importance: 4,
        visibility: 1,
      });
    } catch {
      // 通道通常只在 Android 需要；失败时继续用默认通道。
    }

    const notifications = paydayJobs.flatMap((job) =>
      nextOccurrences(job.payday as number).map((at, occurrence) => ({
        id: paydayNotificationBaseId(job.id) + occurrence,
        title: '今天发薪',
        body: `${job.name} · 记得核对结算和登记收款`,
        channelId: CHANNEL_ID,
        schedule: { at, allowWhileIdle: true },
        extra: { kind: PAYDAY_KIND, jobId: job.id, jobName: job.name },
      })),
    );
    const pending = await LocalNotifications.getPending();
    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
    }

    const nextIds = new Set(notifications.map((notification) => notification.id));
    const stale = pending.notifications
      .filter((item) => item.extra?.kind === PAYDAY_KIND && !nextIds.has(item.id))
      .map((item) => ({ id: item.id }));
    if (stale.length > 0) {
      await LocalNotifications.cancel({ notifications: stale });
    }
    return notifications.length;
  } catch (error) {
    console.warn('发薪通知调度失败', error);
    return 0;
  }
}
