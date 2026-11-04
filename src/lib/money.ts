/** 金额四舍五入到分，避免浮点误差 */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatMoney(
  value: number,
  options: { decimals?: number; symbol?: boolean; signed?: boolean } = {},
): string {
  const { decimals = 2, symbol = false, signed = false } = options;
  const safe = Number.isFinite(value) ? value : 0;
  const rounded = Number(safe.toFixed(decimals));
  const abs = Math.abs(rounded);
  const text = abs.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const sign = rounded < 0 ? '-' : signed && rounded > 0 ? '+' : '';
  return `${sign}${symbol ? '¥' : ''}${text}`;
}

/** 大金额拆成整数 / 小数两段，便于排版 */
export function splitMoney(value: number): { negative: boolean; int: string; decimal: string } {
  const safe = round2(value);
  const negative = safe < 0;
  const [int, decimal] = Math.abs(safe).toFixed(2).split('.');
  return {
    negative,
    int: Number(int).toLocaleString('zh-CN'),
    decimal,
  };
}

export function formatHours(hours: number): string {
  const safe = round2(hours);
  return Number.isInteger(safe) ? String(safe) : String(safe).replace(/0+$/, '');
}

export function formatCompactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000) {
    return `${(value / 10000).toFixed(abs >= 100000 ? 0 : 1).replace(/\.0$/, '')}万`;
  }
  return formatMoney(value, { decimals: abs % 1 === 0 ? 0 : 2 });
}

export function toAmount(value: string | number, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
