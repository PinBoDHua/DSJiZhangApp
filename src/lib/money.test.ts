import { describe, expect, it } from 'vitest';
import { formatMoney, round2 } from './money';

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
describe('formatMoney 展示舍入', () => {
  it('先按分舍入再展示，避免显示与账目差 1 分', () => {
    // toFixed 直接处理 8.165 得到 8.16，与 round2 的 8.17 分叉。
    expect(formatMoney(8.165)).toBe('8.17');
    expect(formatMoney(2.675)).toBe('2.68');
    expect(formatMoney(0.1 + 0.2)).toBe('0.30');
  });

  it('保留符号、千分位与负值口径', () => {
    expect(formatMoney(1234.5, { symbol: true })).toBe('¥1,234.50');
    expect(formatMoney(-20)).toBe('-20.00');
    // 负值半分沿用 round2 的「向 +∞」口径（-8.165 → -8.16），与账目一致。
    expect(formatMoney(-8.165)).toBe('-8.16');
    expect(formatMoney(12, { signed: true })).toBe('+12.00');
    expect(formatMoney(1250.4, { decimals: 0 })).toBe('1,250');
  });
});
