import { downloadText } from './storage';
import { saveFileToDownloads } from './saveFile';

type SaveResult = 'web' | 'native';

interface SaveOptions {
  overwrite?: boolean;
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

/** 原生 App 写入公共下载目录；网页继续用普通下载。 */
export async function saveBlobFile(
  blob: Blob,
  filename: string,
  options: SaveOptions = {},
): Promise<SaveResult> {
  if (isNativeApp()) {
    await saveFileToDownloads(blob, filename, options);
    return 'native';
  }
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
