import { registerPlugin } from '@capacitor/core';

interface SaveFileResult {
  path: string;
  uri: string;
}

interface PruneResult {
  deleted: number;
}

interface SaveFilePlugin {
  save(options: {
    filename: string;
    mimeType: string;
    data: string;
    subdir?: string;
  }): Promise<SaveFileResult>;
  prune(options: { prefix: string; keep: number; subdir?: string }): Promise<PruneResult>;
}

const SaveFile = registerPlugin<SaveFilePlugin>('SaveFile');
const MAX_NATIVE_SAVE_BYTES = 32 * 1024 * 1024;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.onabort = () => reject(new Error('文件读取已取消'));
    reader.readAsDataURL(blob);
  });
}

/** 写入 Android 公共下载目录：Download/Xinshi/，不依赖分享面板。 */
export async function saveFileToDownloads(
  blob: Blob,
  filename: string,
  options: { subdirectory?: string } = {},
): Promise<string> {
  if (blob.size > MAX_NATIVE_SAVE_BYTES) {
    throw new Error('文件超过 32 MB，已停止直接保存以避免手机内存不足');
  }
  const data = await blobToBase64(blob);
  const result = await SaveFile.save({
    filename,
    mimeType: blob.type || 'application/octet-stream',
    data,
    subdir: options.subdirectory,
  });
  return result.path;
}

/** 只清理Download/Xinshi（或指定子目录）下固定前缀的文件，按修改时间保留最新 keep 份。 */
export async function pruneDownloadFiles(
  prefix: string,
  keep: number,
  subdirectory?: string,
): Promise<number> {
  const result = await SaveFile.prune({ prefix, keep, subdir: subdirectory });
  return result.deleted;
}
