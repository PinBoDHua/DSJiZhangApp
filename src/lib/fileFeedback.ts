import type { ToastTone } from '../types';

/** 与 lib/native.ts 的 SaveResult 同口径：web=浏览器下载，native=写入公共下载目录，shared=系统分享面板。 */
export type SaveResult = 'web' | 'native' | 'shared';

export interface SaveFeedback {
  /** 可直接传给 toast 的文案 */
  message: string;
  tone: ToastTone;
  /**
   * 能否按「已保存」处理（例如重置离机备份提醒）：
   * 'shared' 只是打开了系统分享面板，用户可能取消，不能算已保存；
   * 'web' 已触发浏览器下载、'native' 已写入公共下载目录，均按已保存处理。
   */
  backedUp: boolean;
}

/**
 * 统一「保存结果 → 文案」映射（审计 UI-22）。
 * Android 9 及以下走系统分享面板（'shared'），面板弹出不代表文件已经落盘，
 * 文案必须请用户确认，不能提示「已保存」。
 */
export function saveFeedback(result: SaveResult, subject: string): SaveFeedback {
  switch (result) {
    case 'native':
      return {
        message: `${subject} 已保存到「下载/Xinshi」`,
        tone: 'success',
        backedUp: true,
      };
    case 'shared':
      return {
        message: `${subject}：已打开系统分享面板，请确认文件已保存`,
        tone: 'info',
        backedUp: false,
      };
    default:
      return {
        message: `${subject}：已触发下载，请确认文件已保存`,
        tone: 'info',
        backedUp: true,
      };
  }
}

/** 只需要文案时用它，语气由调用方自行决定。 */
export function saveMessage(result: SaveResult, subject: string): string {
  return saveFeedback(result, subject).message;
}
