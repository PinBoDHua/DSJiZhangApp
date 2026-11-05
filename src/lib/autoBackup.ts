import type { AppState } from '../types';
import { buildExportPayload } from './storage';
import { isNativeApp, saveTextFile } from './native';
import { pruneDownloadFiles } from './saveFile';
import { markBackedUp } from './backupStatus';

export const AUTO_BACKUP_KEY = 'xinshi.autoBackup';
export const AUTO_BACKUP_PREFIX = '薪时自动备份-';
export const AUTO_BACKUP_KEEP = 14;
export const AUTO_BACKUP_SUBDIR = '自动备份';

export interface AutoBackupSettings {
  enabled: boolean;
  keep: number;
  lastRunAt?: string;
  lastFile?: string;
  lastError?: string;
}

export const DEFAULT_AUTO_BACKUP: AutoBackupSettings = {
  enabled: false,
  keep: AUTO_BACKUP_KEEP,
};

function localDateKey(value: Date): string {
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function readAutoBackupSettings(): AutoBackupSettings {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return { ...DEFAULT_AUTO_BACKUP };
    const parsed = JSON.parse(raw) as Partial<AutoBackupSettings>;
    const keep = Number.isFinite(parsed.keep) ? Math.max(1, Math.min(60, Number(parsed.keep))) : AUTO_BACKUP_KEEP;
    return {
      enabled: parsed.enabled === true,
      keep,
      lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : undefined,
      lastFile: typeof parsed.lastFile === 'string' ? parsed.lastFile : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
    };
  } catch {
    return { ...DEFAULT_AUTO_BACKUP };
  }
}

export function writeAutoBackupSettings(patch: Partial<AutoBackupSettings>): AutoBackupSettings {
  const next = { ...readAutoBackupSettings(), ...patch };
  try {
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(next));
  } catch {
    // 本地存储不可用时不影响导出
  }
  return next;
}

export function autoBackupFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${AUTO_BACKUP_PREFIX}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}

export function shouldRunAutoBackup(
  settings: AutoBackupSettings,
  state: AppState,
  options: { now?: Date; native?: boolean } = {},
): boolean {
  if (!settings.enabled) return false;
  if (options.native === false) return false;
  if (state.entries.length === 0) return false;
  const now = options.now ?? new Date();
  if (!settings.lastRunAt) return true;
  const last = new Date(settings.lastRunAt);
  if (Number.isNaN(last.getTime())) return true;
  return localDateKey(last) !== localDateKey(now);
}

let running: Promise<AutoBackupResult> | null = null;

export interface AutoBackupResult {
  ran: boolean;
  path?: string;
  pruned?: number;
  error?: string;
}

export async function runAutoBackup(
  state: AppState,
  options: { now?: Date; native?: boolean } = {},
): Promise<AutoBackupResult> {
  if (running) return running;
  const settings = readAutoBackupSettings();
  const native = options.native ?? isNativeApp();
  if (!shouldRunAutoBackup(settings, state, { ...options, native })) return { ran: false };
  const now = options.now ?? new Date();

  running = (async () => {
    try {
      const filename = autoBackupFileName(now);
      const result = await saveTextFile(filename, buildExportPayload(state), undefined, {
        overwrite: true,
        subdirectory: AUTO_BACKUP_SUBDIR,
      });
      const pruned = await pruneDownloadFiles(
        AUTO_BACKUP_PREFIX,
        settings.keep,
        AUTO_BACKUP_SUBDIR,
      );
      writeAutoBackupSettings({
        lastRunAt: now.toISOString(),
        lastFile:
          result === 'native'
            ? `下载/Xinshi/${AUTO_BACKUP_SUBDIR}/${filename}`
            : filename,
        lastError: undefined,
      });
      markBackedUp(now);
      return { ran: true, path: filename, pruned };
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动备份失败';
      writeAutoBackupSettings({ lastError: message });
      return { ran: false, error: message };
    } finally {
      running = null;
    }
  })();

  return running;
}
