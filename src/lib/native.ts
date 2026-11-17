import { downloadText } from './storage';
import { saveFileToDownloads } from './saveFile';

/**
 * 保存结果语义：
 * - native：已写入本机公共下载目录，可以确认打开文件；
 * - shared：旧系统只能弹系统分享面板，用户可能取消，**未真正落盘**；
 * - web：只触发了浏览器下载，无法感知用户取消或被浏览器拦截；调用方应提示
 *   「已触发下载，请确认保存」，不能当成已落盘（不要直接 markBackedUp）。
 */
type SaveResult = 'web' | 'native' | 'shared';

interface SaveOptions {
  subdirectory?: string;
}

interface CapacitorWindow {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => string;
  };
}

export function isNativeApp(): boolean {
  const capacitor = (window as unknown as CapacitorWindow).Capacitor;
  return Boolean(capacitor?.isNativePlatform?.());
}

export function isAndroidApp(): boolean {
  const capacitor = (window as unknown as CapacitorWindow).Capacitor;
  return isNativeApp() && capacitor?.getPlatform?.() === 'android';
}

/** 原生 App 写入公共下载目录（旧系统走分享面板）；网页继续用普通下载。 */
export async function saveBlobFile(
  blob: Blob,
  filename: string,
  options: SaveOptions = {},
): Promise<SaveResult> {
  if (isNativeApp()) {
    const saved = await saveFileToDownloads(blob, filename, options);
    return saved.shared ? 'shared' : 'native';
  }
  // 网页端只能触发浏览器下载：是否真的保存 / 是否被拦截都不可知，调用方按
  // 「已触发下载，请确认保存」提示，不应据此重置备份提醒。
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'web';
}

export async function saveTextFile(
  filename: string,
  text: string,
  mimeType = 'application/json;charset=utf-8',
  options: SaveOptions = {},
): Promise<SaveResult> {
  if (isNativeApp()) {
    return saveBlobFile(new Blob([text], { type: mimeType }), filename, options);
  }
  downloadText(filename, text, mimeType);
  return 'web';
}
