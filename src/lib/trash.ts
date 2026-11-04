import type { TrashedJob } from '../types';

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function trashRemainingDays(deletedAt: string, now = Date.now()): number {
  const deleted = Date.parse(deletedAt);
  if (!Number.isFinite(deleted)) return 0;
  const age = Math.max(0, now - deleted);
  return Math.max(0, TRASH_RETENTION_DAYS - Math.floor(age / DAY_MS));
}

export function purgeExpiredTrash(
  items: TrashedJob[],
  now = Date.now(),
): TrashedJob[] {
  return items.filter((item) => {
    const deleted = Date.parse(item.deletedAt);
    if (!Number.isFinite(deleted)) return false;
    return now - deleted < TRASH_RETENTION_DAYS * DAY_MS;
  });
}
