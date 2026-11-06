import { createId } from './id';

/** 考勤照片只存本机 IndexedDB，不进账本 JSON、不上传。 */
export const PHOTO_DB_NAME = 'xinshi.photos';
export const PHOTO_STORE = 'photos';
export const PHOTO_DB_VERSION = 1;
/** 单张压缩后的照片上限，避免一张图吃掉太多本机空间 */
export const PHOTO_MAX_BYTES = 600 * 1024;

export interface PhotoRecord {
  id: string;
  dataUrl: string;
  createdAt: string;
  bytes: number;
}

export function createPhotoId(): string {
  return createId('photo');
}

export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openPhotoDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('本机不支持照片存储'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('照片存储打开失败'));
    request.onblocked = () => reject(new Error('照片存储被其他页面占用，请关闭后重试'));
  }).catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('照片读写失败'));
  });
}

export async function putPhoto(id: string, dataUrl: string): Promise<void> {
  if (!dataUrl.startsWith('data:image/')) throw new Error('照片格式不正确');
  const bytes = estimateDataUrlBytes(dataUrl);
  if (bytes > PHOTO_MAX_BYTES) throw new Error('照片压缩后仍然太大，请换一张');
  const db = await openPhotoDb();
  const record: PhotoRecord = {
    id,
    dataUrl,
    createdAt: new Date().toISOString(),
    bytes,
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const request = tx.objectStore(PHOTO_STORE).put(record);
    request.onsuccess = () => undefined;
    request.onerror = () => reject(request.error ?? new Error('照片保存失败'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('照片保存失败'));
  });
}

export async function getPhoto(id: string): Promise<PhotoRecord | null> {
  const db = await openPhotoDb();
  const result = await requestResult<PhotoRecord | undefined>(
    db.transaction(PHOTO_STORE, 'readonly').objectStore(PHOTO_STORE).get(id),
  );
  return result ?? null;
}

export async function deletePhoto(id: string): Promise<void> {
  await deletePhotos([id]);
}

export async function deletePhotos(ids: string[]): Promise<void> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return;
  const db = await openPhotoDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    for (const id of unique) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('照片删除失败'));
  });
}

export async function clearPhotos(): Promise<void> {
  const db = await openPhotoDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('照片清理失败'));
  });
}

/** 启动时清理不再被任何工记（含回收站工记）引用的照片 */
export async function prunePhotos(keepIds: Set<string>): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await openPhotoDb();
  return new Promise<number>((resolve, reject) => {
    let removed = 0;
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      const record = cursor.value as PhotoRecord;
      if (!keepIds.has(record.id)) {
        cursor.delete();
        removed += 1;
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('照片清理失败'));
    tx.oncomplete = () => resolve(removed);
    tx.onerror = () => reject(tx.error ?? new Error('照片清理失败'));
  });
}

export async function photoUsage(): Promise<{ count: number; bytes: number }> {
  if (typeof indexedDB === 'undefined') return { count: 0, bytes: 0 };
  const db = await openPhotoDb();
  return new Promise((resolve, reject) => {
    let count = 0;
    let bytes = 0;
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const cursorRequest = tx.objectStore(PHOTO_STORE).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      count += 1;
      bytes += Number((cursor.value as PhotoRecord).bytes) || 0;
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('照片统计失败'));
    tx.oncomplete = () => resolve({ count, bytes });
    tx.onerror = () => reject(tx.error ?? new Error('照片统计失败'));
  });
}
