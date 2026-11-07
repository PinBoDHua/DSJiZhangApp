import type {
  LocalNotificationsPlugin,
  LocalNotificationSchema,
  PermissionStatus,
} from '@capacitor/local-notifications';
import type { Settings } from '../types';
import { addDays, toISODate } from './date';
import { isNativeApp } from './native';

export type ReminderPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

const DAILY_KIND = 'xinshi-daily';
const DAILY_CHANNEL_ID = 'xinshi-daily';
const DAILY_ID_BASE = 8100;
const DAILY_DAYS = 30;
const TEST_ID = 8199;

interface LoadedPlugin {
  plugin: LocalNotificationsPlugin;
}

async function loadPlugin(): Promise<LoadedPlugin | null> {
  if (!isNativeApp()) return null;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    // 不能直接 return LocalNotifications：Capacitor 插件代理是可 then 对象，
    // async 函数返回它会被 Promise 当成 thenable 解包，触发 "then() is not implemented"。
    return { plugin: LocalNotifications };
  } catch {
    return null;
  }
}

function normalizePermission(status: PermissionStatus): ReminderPermission {
  if (status.display === 'granted') return 'granted';
  if (status.display === 'denied') return 'denied';
  return 'prompt';
}

export async function getNativeReminderPermission(): Promise<ReminderPermission> {
  const loaded = await loadPlugin();
  if (!loaded) return 'unsupported';
  try {
    return normalizePermission(await loaded.plugin.checkPermissions());
  } catch {
    return 'unsupported';
  }
}

export async function requestNativeReminderPermission(): Promise<ReminderPermission> {
  const loaded = await loadPlugin();
  if (!loaded) return 'unsupported';
  try {
    return normalizePermission(await loaded.plugin.requestPermissions());
  } catch {
    return 'denied';
  }
}

async function ensureDailyChannel(plugin: LocalNotificationsPlugin): Promise<void> {
  try {
    await plugin.createChannel({
      id: DAILY_CHANNEL_ID,
      name: '每日记工提醒',
      description: '每天到点提醒记工，当天已记工会自动跳过',
      importance: 4,
      visibility: 1,
    });
  } catch {
    // 通道只在 Android 需要；已存在或失败时继续用默认通道。
  }
}

function notificationAt(date: string, time: string): Date | null {
  const [hours, minutes] = time.split(':').map(Number);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  const at = new Date(`${date}T00:00:00`);
  at.setHours(hours, minutes, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

export interface DailyReminderPlanItem {
  id: number;
  date: string;
  at: Date;
}

/** 生成未来 30 天的提醒计划；当天已记工或时间已过时从明天开始。 */
export function buildDailyReminderPlan(
  time: string,
  includeToday: boolean,
  now = new Date(),
  days = DAILY_DAYS,
): DailyReminderPlanItem[] {
  const result: DailyReminderPlanItem[] = [];
  const start = toISODate(now);
  for (let offset = 0; offset < days; offset += 1) {
    if (offset === 0 && !includeToday) continue;
    const date = addDays(start, offset);
    const at = notificationAt(date, time);
    if (!at || at.getTime() <= now.getTime()) continue;
    result.push({ id: DAILY_ID_BASE + offset, date, at });
  }
  return result;
}

async function pendingIds(plugin: LocalNotificationsPlugin): Promise<number[]> {
  try {
    const pending = await plugin.getPending();
    return pending.notifications
      .filter(
        (item) =>
          item.extra?.kind === DAILY_KIND ||
          (item.id >= DAILY_ID_BASE && item.id < DAILY_ID_BASE + DAILY_DAYS),
      )
      .map((item) => item.id);
  } catch {
    return [];
  }
}

export async function cancelDailyReminder(): Promise<void> {
  const loaded = await loadPlugin();
  if (!loaded) return;
  try {
    const ids = await pendingIds(loaded.plugin);
    if (ids.length > 0) {
      await loaded.plugin.cancel({ notifications: ids.map((id) => ({ id })) });
    }
  } catch {
    // 取消失败不影响已关闭的开关。
  }
}

/**
 * 在原生端重排未来 30 天的每日提醒。
 * - 当天已记工或提醒时间已过时，从明天开始；
 * - 新计划调度成功后再清理不在新 ID 集合中的旧提醒，失败时保留旧提醒；
 * - 不主动请求权限，权限由用户在「我的」里开启。
 */
export async function syncDailyReminder(
  reminder: Settings['reminder'],
  includeToday: boolean,
): Promise<number> {
  const loaded = await loadPlugin();
  if (!loaded) return 0;
  const plugin = loaded.plugin;
  try {
    const permission = await plugin.checkPermissions();
    if (permission.display !== 'granted') return 0;
    await ensureDailyChannel(plugin);
    const notifications: LocalNotificationSchema[] = buildDailyReminderPlan(
      reminder.time,
      includeToday,
    ).map((item) => ({
      id: item.id,
      title: '薪时 · 今天还没记工',
      body: '花 10 秒把今天的工时补上，月底不用翻聊天记录。',
      channelId: DAILY_CHANNEL_ID,
      schedule: { at: item.at, allowWhileIdle: true },
      extra: { kind: DAILY_KIND, date: item.date },
    }));
    const ids = await pendingIds(plugin);
    if (notifications.length > 0) {
      await plugin.schedule({ notifications });
    }

    const nextIds = new Set(notifications.map((notification) => notification.id));
    const staleIds = ids.filter((id) => !nextIds.has(id));
    if (staleIds.length > 0) {
      await plugin.cancel({ notifications: staleIds.map((id) => ({ id })) });
    }
    return notifications.length;
  } catch (error) {
    console.warn('每日提醒调度失败', error);
    return 0;
  }
}

export async function sendTestNativeReminder(): Promise<boolean> {
  const loaded = await loadPlugin();
  if (!loaded) return false;
  const plugin = loaded.plugin;
  try {
    const permission = await plugin.checkPermissions();
    if (permission.display !== 'granted') return false;
    await ensureDailyChannel(plugin);
    try {
      await plugin.cancel({ notifications: [{ id: TEST_ID }] });
    } catch {
      // 没有旧测试通知时忽略。
    }
    await plugin.schedule({
      notifications: [
        {
          id: TEST_ID,
          title: '薪时 · 测试提醒',
          body: '到点我会这样提醒你记工。',
          channelId: DAILY_CHANNEL_ID,
          schedule: { at: new Date(Date.now() + 1500) },
          extra: { kind: 'xinshi-test' },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}
