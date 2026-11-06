import { weekdayCN } from './date';
import { formatHours } from './money';
import { PHOTO_MAX_BYTES, estimateDataUrlBytes } from './photos';

export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_INPUT_MAX_BYTES = 25 * 1024 * 1024;
const JPEG_QUALITY = 0.72;
const FALLBACK_EDGE = 1024;
const FALLBACK_QUALITY = 0.62;
const FONT =
  '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", sans-serif';
const INK = '#F8F2E5';
const ACCENT = '#E9A13B';

export interface PhotoStampMeta {
  jobName: string;
  /** YYYY-MM-DD */
  date: string;
  hours: number;
  capturedAt?: string | Date;
}

export interface PhotoStampLines {
  badge: string;
  title: string;
  subtitle: string;
  footer: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function clockText(value?: string | Date): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 水印文字保持纯函数，便于单测与后续复用 */
export function photoStampLines(meta: PhotoStampMeta): PhotoStampLines {
  const jobName = meta.jobName.trim() || '未命名工作';
  const date = meta.date.replace(/-/g, '.');
  const hours = formatHours(meta.hours);
  const clock = clockText(meta.capturedAt);
  return {
    badge: '薪时 · 考勤留痕',
    title: jobName,
    subtitle: `${date} ${weekdayCN(meta.date)}${meta.hours > 0 ? ` · 在岗 ${hours} 小时` : ''}`,
    footer: clock ? `拍摄 ${clock} · 仅存本机` : '仅存本机',
  };
}

export function photoFileName(jobName: string, date: string): string {
  const safeJob = jobName.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 16) || '考勤';
  return `薪时考勤照片-${safeJob}-${date}.jpg`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        // 继续走 Image 回退
      }
    }
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('照片读取失败，请换一张'));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function renderPhoto(
  bitmap: ImageBitmap | HTMLImageElement,
  meta: PhotoStampMeta,
  maxEdge: number,
  quality: number,
): string {
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  if (!sourceWidth || !sourceHeight) throw new Error('照片尺寸不正确');

  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持照片水印');

  ctx.drawImage(bitmap, 0, 0, width, height);

  const unit = Math.min(2, Math.max(0.5, width / 1080));
  const lines = photoStampLines(meta);

  // 左上角品牌角标
  const badgeSize = 17 * unit;
  ctx.font = `600 ${badgeSize}px ${FONT}`;
  const badgeTextWidth = ctx.measureText(lines.badge).width;
  const badgeHeight = 34 * unit;
  const badgeX = 20 * unit;
  const badgeY = 20 * unit;
  roundRect(ctx, badgeX, badgeY, badgeTextWidth + 28 * unit, badgeHeight, badgeHeight / 2);
  ctx.fillStyle = 'rgba(20, 86, 61, 0.82)';
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(lines.badge, badgeX + 14 * unit, badgeY + badgeHeight / 2 + 1);

  // 底部渐变与信息
  const gradientTop = height - Math.max(150 * unit, height * 0.3);
  const gradient = ctx.createLinearGradient(0, gradientTop, 0, height);
  gradient.addColorStop(0, 'rgba(10, 28, 20, 0)');
  gradient.addColorStop(0.55, 'rgba(10, 28, 20, 0.62)');
  gradient.addColorStop(1, 'rgba(10, 28, 20, 0.9)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, gradientTop, width, height - gradientTop);

  const margin = 30 * unit;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  const titleSize = Math.max(18, 38 * unit);
  const subtitleSize = Math.max(13, 24 * unit);
  const footerSize = Math.max(11, 18 * unit);

  ctx.fillStyle = ACCENT;
  ctx.fillRect(margin, height - 132 * unit, 4 * unit, 22 * unit);
  ctx.fillStyle = INK;
  ctx.font = `700 ${titleSize}px ${FONT}`;
  ctx.fillText(lines.title, margin + 16 * unit, height - 112 * unit);
  ctx.fillStyle = 'rgba(248, 242, 229, 0.82)';
  ctx.font = `500 ${subtitleSize}px ${FONT}`;
  ctx.fillText(lines.subtitle, margin + 16 * unit, height - 76 * unit);
  ctx.fillStyle = 'rgba(248, 242, 229, 0.56)';
  ctx.font = `400 ${footerSize}px ${FONT}`;
  ctx.fillText(lines.footer, margin + 16 * unit, height - 44 * unit);

  return canvas.toDataURL('image/jpeg', quality);
}

/** 拍照 / 选图 → 压缩 → 加日期岗位水印，返回 data URL；只用于本机存储 */
export async function createWatermarkedPhoto(
  file: File,
  meta: PhotoStampMeta,
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size <= 0) throw new Error('照片内容为空，请重选');
  if (file.size > PHOTO_INPUT_MAX_BYTES) throw new Error('照片太大，请选 25MB 以内的图片');

  const bitmap = await decodeImage(file);
  try {
    let dataUrl = renderPhoto(bitmap, meta, PHOTO_MAX_EDGE, JPEG_QUALITY);
    if (estimateDataUrlBytes(dataUrl) > PHOTO_MAX_BYTES) {
      dataUrl = renderPhoto(bitmap, meta, FALLBACK_EDGE, FALLBACK_QUALITY);
    }
    if (estimateDataUrlBytes(dataUrl) > PHOTO_MAX_BYTES) {
      throw new Error('照片压缩后仍然太大，请换一张');
    }
    return dataUrl;
  } finally {
    if ('close' in bitmap) bitmap.close();
  }
}
