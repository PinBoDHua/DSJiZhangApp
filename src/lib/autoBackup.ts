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

/** 失败退避记录（独立键，不改 AutoBackupSettings 结构，避免跨模块类型联动） */
export const AUTO_BACKUP_FAILURE_KEY = 'xinshi.autoBackupFailures';
/** 同一自然日连续失败达到这个次数后，当天不再重试 */
export const AUTO_BACKUP_MAX_FAILURES_PER_DAY = 3;

export interface AutoBackupFailureState {
  /** 自然日（本地时区） */
  date: string;
  count: number;
  lastError?: string;
}

export function readAutoBackupFailure(): AutoBackupFailureState | null {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_FAILURE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AutoBackupFailureState>;
    if (typeof parsed.date !== 'string') return null;
    const count = Number.isFinite(parsed.count) ? Math.max(0, Number(parsed.count)) : 0;
    return {
      date: parsed.date,
      count,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
    };
  } catch {
    return null;
  }
}

function writeAutoBackupFailure(failure: AutoBackupFailureState | null): void {
  try {
    if (failure) localStorage.setItem(AUTO_BACKUP_FAILURE_KEY, JSON.stringify(failure));
    else localStorage.removeItem(AUTO_BACKUP_FAILURE_KEY);
  } catch {
    // 本地存储不可用时退避失效，但不能阻断备份流程
  }
}

/** 同一自然日连续失败 >= 3 次后当天停摆，次日自动恢复。 */
function isFailureBackoffActive(now: Date): boolean {
  const failure = readAutoBackupFailure();
  if (!failure) return false;
  if (failure.date !== localDateKey(now)) return false;
  return failure.count >= AUTO_BACKUP_MAX_FAILURES_PER_DAY;
}

function recordAutoBackupFailure(now: Date, message: string): void {
  const date = localDateKey(now);
  const previous = readAutoBackupFailure();
  const count = previous && previous.date === date ? previous.count + 1 : 1;
  writeAutoBackupFailure({ date, count, lastError: message });
}

export function autoBackupFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${AUTO_BACKUP_PREFIX}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
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
  // 原生桥持续失败（如 45s 超时）时不要每记一笔就重试整包导出：同一天失败 3 次后停到次日。
  if (isFailureBackoffActive(now)) return false;
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
  /** 备份已写入但旧文件清理失败；不影响本次备份成功。 */
  warning?: string;
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
        subdirectory: AUTO_BACKUP_SUBDIR,
      });
      // Android 5–9 只能弹系统分享面板，用户可能取消：没真正落盘就不能记成“已备份”。
      const shared = result === 'shared';
      if (shared) {
        // 分享面板弹出 = 是否落盘未确认：本轮不算完成 —— 不写 lastRunAt / lastFile，
        // 不清上次失败，也不清失败退避，下次打开 App 会自然重试。
        // 这里也不清理旧备份：新文件还没确认写入时清理只会白减备份份数。
        return {
          ran: true,
          path: filename,
          warning:
            '旧系统已打开系统分享面板，请确认本次备份已保存；本次不计入“已备份”，下次打开会重试，旧备份需要手动清理',
        };
      }
      // 清理旧备份失败不能把这次备份算作失败：文件已经写进去了，下次再清理即可。
      let pruned = 0;
      let pruneError: string | undefined;
      try {
        pruned = await pruneDownloadFiles(
          AUTO_BACKUP_PREFIX,
          settings.keep,
          AUTO_BACKUP_SUBDIR,
        );
      } catch (error) {
        pruneError = error instanceof Error ? error.message : '旧自动备份清理失败';
      }
      writeAutoBackupSettings({
        lastRunAt: now.toISOString(),
        lastFile:
          result === 'native'
            ? `下载/Xinshi/${AUTO_BACKUP_SUBDIR}/${filename}`
            : filename,
        // 清理失败不是备份失败，不写进“上次失败”，只在下一次运行前继续尝试清理。
        lastError: undefined,
      });
      // 本次成功即清零失败退避记录。
      writeAutoBackupFailure(null);
      markBackedUp(now);
      return { ran: true, path: filename, pruned, warning: pruneError };
    } catch (error) {
      const message = error instanceof Error ? error.message : '自动备份失败';
      recordAutoBackupFailure(now, message);
      writeAutoBackupSettings({ lastError: message });
      return { ran: false, error: message };
    } finally {
      running = null;
    }
  })();

  return running;
}
