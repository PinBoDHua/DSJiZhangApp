import { describe, expect, it } from 'vitest';
import { addMinutesToTime, DURATION_PRESETS, endTimeForDuration } from './timePreset';

describe('常用时长快选', () => {
  it('提供 4 / 6 / 8 / 10 / 12 小时', () => {
    expect([...DURATION_PRESETS]).toEqual([4, 6, 8, 10, 12]);
  });

  it('按开始时间 + 时长 + 休息算结束时间', () => {
    expect(endTimeForDuration('08:00', 8, 60)).toBe('17:00');
    expect(endTimeForDuration('09:00', 6, 120)).toBe('17:00');
    expect(endTimeForDuration('14:00', 4, 0)).toBe('18:00');
  });

  it('跨零点自动折回', () => {
    expect(addMinutesToTime('22:00', 600)).toBe('08:00');
    expect(addMinutesToTime('01:30', -180)).toBe('22:30');
  });
});
