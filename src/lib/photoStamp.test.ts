import { describe, expect, it } from 'vitest';
import { PHOTO_MAX_EDGE, photoFileName, photoStampLines } from './photoStamp';

describe('考勤照片水印', () => {
  const capturedAt = new Date(2026, 10, 6, 18, 5);

  it('包含岗位、日期、工时与拍摄时间', () => {
    const lines = photoStampLines({
      jobName: '  老宅装修  ',
      date: '2026-11-06',
      hours: 6,
      capturedAt,
    });
    expect(lines.badge).toBe('薪时 · 考勤留痕');
    expect(lines.title).toBe('老宅装修');
    expect(lines.subtitle).toContain('2026.11.06');
    expect(lines.subtitle).toContain('在岗 6 小时');
    expect(lines.footer).toContain('拍摄 18:05');
    expect(lines.footer).toContain('仅存本机');
  });

  it('没有工时时不写在岗时长，空岗位回退为未命名工作', () => {
    const lines = photoStampLines({
      jobName: '   ',
      date: '2026-11-06',
      hours: 0,
      capturedAt,
    });
    expect(lines.title).toBe('未命名工作');
    expect(lines.subtitle).not.toContain('在岗');
  });

  it('文件命名去掉非法字符并截断岗位名', () => {
    expect(photoFileName('a/b:c', '2026-11-06')).toBe(
      '薪时考勤照片-abc-2026-11-06.jpg',
    );
    expect(photoFileName('一二三四五六七八九十一二三四五六七八', '2026-11-06')).toBe(
      '薪时考勤照片-一二三四五六七八九十一二三四五六-2026-11-06.jpg',
    );
  });

  it('压缩长边上限固定为 1280', () => {
    expect(PHOTO_MAX_EDGE).toBe(1280);
  });
});
