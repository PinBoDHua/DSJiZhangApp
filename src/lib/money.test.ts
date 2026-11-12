import { describe, expect, it } from 'vitest';
import { round2 } from './money';

describe('round2 金额舍入', () => {
  it('半分精确进位，不受浮点乘积下偏影响', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(8.165)).toBe(8.17);
    expect(round2(16.33 * 0.5)).toBe(8.17);
    expect(round2(0.145)).toBe(0.15);
  });

  it('负值保持原有口径（半分向正无穷舍入）', () => {
    expect(round2(-1.005)).toBe(-1);
    expect(round2(-8.165)).toBe(-8.16);
    expect(round2(-1.006)).toBe(-1.01);
  });

  it('常规值与非法值', () => {
    expect(round2(8.164)).toBe(8.16);
    expect(round2(8.166)).toBe(8.17);
    expect(round2(0)).toBe(0);
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
    expect(round2(1e21)).toBe(1e21);
  });
});