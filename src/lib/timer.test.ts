import { describe, expect, it } from 'vitest';
import { buildTimerTimes, elapsedSeconds, formatElapsed, isTimerOverlong } from './timer';

describe('打卡计时', () => {
  it('格式化为时:分:秒', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(3661)).toBe('01:01:01');
    expect(formatElapsed(90061)).toBe('25:01:01');
  });

  it('按时间戳计算已过秒数', () => {
    expect(
      elapsedSeconds('2026-11-04T00:00:00.000Z', Date.parse('2026-11-04T01:01:01.000Z')),
    ).toBe(3661);
  });

  it('结束计时带出本地日期和起止时间', () => {
    const start = new Date(2026, 10, 4, 9, 30, 0);
    const end = new Date(2026, 10, 4, 18, 5, 0);
    const times = buildTimerTimes(start.toISOString(), end);
    expect(times.date).toBe('2026-11-04');
    expect(times.startTime).toBe('09:30');
    expect(times.endTime).toBe('18:05');
    expect(times.breakMinutes).toBe(0);
  });

  it('识别超过 24 小时的计时', () => {
    expect(isTimerOverlong(new Date(Date.now() - 23 * 3600 * 1000).toISOString())).toBe(false);
    expect(isTimerOverlong(new Date(Date.now() - 25 * 3600 * 1000).toISOString())).toBe(true);
  });
});
