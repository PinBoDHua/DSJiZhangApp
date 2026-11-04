import type { AppState } from '../types';

export const LAST_BACKUP_KEY = 'xinshi.lastBackup';
export const BACKUP_REMINDER_DAYS = 14;

export function getLastBackupAt(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

export function markBackedUp(at = new Date()): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, at.toISOString());
  } catch {
    // 本地存储不可用时静默失败，不阻断导出
  }
}

export function daysSinceBackup(now = Date.now()): number | null {
  const raw = getLastBackupAt();
  if (!raw) return null;
  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((now - time) / 86_400_000));
}

export function backupIsDue(state: AppState, now = Date.now()): boolean {
  if (state.entries.length === 0) return false;
  const days = daysSinceBackup(now);
  if (days !== null) return days >= BACKUP_REMINDER_DAYS;
  const created = new Date(state.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const age = Math.floor((now - created) / 86_400_000);
  return age >= 7;
}

export function backupDueText(state: AppState, now = Date.now()): string {
  const days = daysSinceBackup(now);
  if (days === null) return '还没有导出过备份';
  if (days === 0) return '今天已备份';
  return `已 ${days} 天没有备份`;
}
