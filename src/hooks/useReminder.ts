import { useEffect } from 'react';
import { todayISO } from '../lib/date';
import { isNativeApp } from '../lib/native';
import type { Settings } from '../types';
import {
  REMINDER_LAST_KEY,
  notificationPermission,
  reminderDue,
  showLocalNotification,
} from '../lib/reminder';

export function useReminder(
  reminder: Settings['reminder'],
  todayEntryCount: number,
): void {
  useEffect(() => {
    if (!reminder.enabled) return;
    // 原生端由系统本地通知调度，App 打开时不再重复弹通知。
    if (isNativeApp()) return;
    let cancelled = false;

    const check = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (todayEntryCount > 0) return;
      if (!reminderDue(reminder.time)) return;
      if (notificationPermission() !== 'granted') return;
      try {
        if (localStorage.getItem(REMINDER_LAST_KEY) === todayISO()) return;
      } catch {
        // localStorage 不可用时继续尝试提醒
      }
      const ok = await showLocalNotification(
        '薪时 · 今天还没记工',
        '花 10 秒把今天的工时补上，月底不用翻聊天记录。',
        'xinshi-daily-reminder',
      );
      if (ok) {
        try {
          localStorage.setItem(REMINDER_LAST_KEY, todayISO());
        } catch {
          // 忽略存储失败
        }
      }
    };

    void check();
    const interval = window.setInterval(check, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reminder.enabled, reminder.time, todayEntryCount]);
}
