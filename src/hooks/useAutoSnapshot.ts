import { useEffect, useRef } from 'react';
import type { AppState } from '../types';
import { isSnapshotStoreAvailable, saveSnapshot } from '../lib/snapshots';

const DAILY_KEY = 'xinshi.snapshotDailyAt';
const IDLE_DEBOUNCE = 3 * 60 * 1000;

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
  const dailyScheduled = useRef(false);
  stateRef.current = state;

  useEffect(() => {
    if (!enabled) return;
    if (!state.onboardingDone || dailyScheduled.current) return;
    if (!isSnapshotStoreAvailable()) return;
    if (state.jobs.length === 0 && state.entries.length === 0) return;

    dailyScheduled.current = true;
    const now = new Date();
    const last = readDailyAt();
    const sameDay = last ? localDateKey(new Date(last)) === localDateKey(now) : false;
    if (sameDay) return;

    window.setTimeout(() => {
      void saveSnapshot(stateRef.current, 'daily-open')
        .then(() => markDailyAt(now))
        .catch(() => undefined);
    }, 1600);
  }, [state.onboardingDone, state.jobs.length, state.entries.length, enabled]);

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
