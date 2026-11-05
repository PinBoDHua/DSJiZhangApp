import type { Settlement } from '../types';

/**
 * 结算快照的短校验码：FNV-1a 32 位，格式 XXXX-XXXX。
 * 没有后端，校验码只用于核对「同一张结算单」的关键字段是否被改动；
 * 它不是数字签名，不能防止对方伪造截图。
 */
export function settlementChecksum(settlement: Settlement): string {
  const canonical = [
    settlement.id,
    settlement.jobId,
    settlement.jobName,
    settlement.periodStart,
    settlement.periodEnd,
    settlement.net.toFixed(2),
    settlement.createdAt,
  ].join('|');
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}
