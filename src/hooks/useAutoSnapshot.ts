import { useCallback, useEffect, useRef } from 'react';
import type { AppState } from '../types';
import { isSnapshotStoreAvailable, saveSnapshot } from '../lib/snapshots';

const DAILY_KEY = 'xinshi.snapshotDailyAt';
const IDLE_DEBOUNCE = 3 * 60 * 1000;
const DAY_RECHECK = 15 * 60 * 1000;

function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readDailyAt(): string | null {
  try {
    return localStorage.getItem(DAILY_KEY);
  } catch {
    return null;
  }
}

function markDailyAt(date: Date): void {
  try {
    localStorage.setItem(DAILY_KEY, date.toISOString());
  } catch {
    // 本地存储不可用时放弃自动快照
  }
}

/**
 * 本机自动快照：
 * - 每天首次进入后拍一张「每日」快照；
 * - 状态变化后空闲 3 分钟拍一张「自动」快照；
 * 不阻塞主流程，失败静默。
 */
export function useAutoSnapshot(state: AppState, enabled = true): void {
  const stateRef = useRef(state);
  const idleTimer = useRef<number | null>(null);
  const scheduledDay = useRef<string | null>(null);
  stateRef.current = state;

  const tryDaily = useCallback(() => {
    if (!enabled) return;
    const current = stateRef.current;
    if (!current.onboardingDone) return;
    if (!isSnapshotStoreAvailable()) return;
    if (current.jobs.length === 0 && current.entries.length === 0) return;

    const now = new Date();
    const dayKey = localDateKey(now);
    if (scheduledDay.current === dayKey) return;
    const last = readDailyAt();
    if (last && localDateKey(new Date(last)) === dayKey) {
      scheduledDay.current = dayKey;
      return;
    }

    scheduledDay.current = dayKey;
    window.setTimeout(() => {
      void saveSnapshot(stateRef.current, 'daily-open')
        .then(() => markDailyAt(new Date()))
        .catch(() => {
          // 保存失败要回退当日标记，否则直到重启前都不会再重试每日快照。
          if (scheduledDay.current === dayKey) scheduledDay.current = null;
        });
    }, 1600);
  }, [enabled]);

  useEffect(() => {
    tryDaily();
  }, [tryDaily, state.onboardingDone, state.jobs.length, state.entries.length]);

  // 跨午夜或从后台回到前台时补一次每日检查：应用长期挂着、记录数不变也要拍每日快照。
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') tryDaily();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(tryDaily, DAY_RECHECK);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [enabled, tryDaily]);

  useEffect(() => {
    if (!enabled) return;
    if (!state.onboardingDone || !isSnapshotStoreAvailable()) return;
    if (state.jobs.length === 0 && state.entries.length === 0) return;

    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      void saveSnapshot(state, 'auto-idle').catch(() => undefined);
    }, IDLE_DEBOUNCE);

    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [state, enabled]);
}