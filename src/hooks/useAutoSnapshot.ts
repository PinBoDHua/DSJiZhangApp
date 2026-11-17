import { useCallback, useEffect, useRef } from 'react';
import type { AppState } from '../types';
import { isSnapshotStoreAvailable, saveSnapshot } from '../lib/snapshots';

const DAILY_KEY = 'xinshi.snapshotDailyAt';
const IDLE_DEBOUNCE = 3 * 60 * 1000;
const DAY_RECHECK = 15 * 60 * 1000;
/** 自动快照失败记录：UI 尚未接线，先落本地存储，避免自动保护长期停摆无感知 */
const ERROR_KEY = 'xinshi.snapshotLastError';

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

function recordSnapshotError(error: unknown): void {
  try {
    localStorage.setItem(
      ERROR_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  } catch {
    // 本地存储不可用时无法记录，不能反过来影响主流程
  }
}

function clearSnapshotError(): void {
  try {
    localStorage.removeItem(ERROR_KEY);
  } catch {
    // 忽略
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
  const dailyTimer = useRef<number | null>(null);
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
    // 定时器入 ref：卸载 / 重新进入后不能留下悬空回调（热重载、测试同理）。
    if (dailyTimer.current) window.clearTimeout(dailyTimer.current);
    dailyTimer.current = window.setTimeout(() => {
      dailyTimer.current = null;
      void saveSnapshot(stateRef.current, 'daily-open')
        .then(() => {
          clearSnapshotError();
          markDailyAt(new Date());
        })
        .catch((error: unknown) => {
          recordSnapshotError(error);
          // 保存失败要回退当日标记，否则直到重启前都不会再重试每日快照。
          if (scheduledDay.current === dayKey) scheduledDay.current = null;
        });
    }, 1600);
  }, [enabled]);

  // 卸载时清掉每日快照定时器：D35 / UI-18。
  useEffect(
    () => () => {
      if (dailyTimer.current) window.clearTimeout(dailyTimer.current);
      dailyTimer.current = null;
    },
    [],
  );

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
      void saveSnapshot(state, 'auto-idle')
        .then(() => clearSnapshotError())
        .catch((error: unknown) => {
          // 不再完全静默：失败原因落本地存储，供排查（UI 提示待后续任务接线）。
          recordSnapshotError(error);
        });
    }, IDLE_DEBOUNCE);

    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [state, enabled]);
}