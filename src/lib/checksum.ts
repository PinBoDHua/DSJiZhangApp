import type { Settlement } from '../types';

/**
 * 结算快照校验码。
 * 新版是 sha256 短码（前缀 `sha256:`），canonical 覆盖全部分项与收款字段：
 * 基础工资 / 加班 / 奖金 / 扣款 / 额外奖扣 / 超休 / 借支 / 工时 / 天数 / 已收金额 / 收款状态等，
 * 任一分项被改动（即使 net 不变）校验码都会变化。
 * 它没有后端，只用于核对「同一张结算单」是否被改动，不是数字签名，不能防止对方伪造截图。
 * 旧版结算单的 FNV-1a 32 位短码（无前缀，形如 XXXX-XXXX）继续用 legacySettlementChecksum 验证。
 */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotr(value: number, shift: number): number {
  return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

/** 纯 JS SHA-256（同步、无依赖）：返回 64 位十六进制小写。 */
function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const prev15 = schedule[index - 15];
      const prev2 = schedule[index - 2];
      const s0 = rotr(prev15, 7) ^ rotr(prev15, 18) ^ (prev15 >>> 3);
      const s1 = rotr(prev2, 17) ^ rotr(prev2, 19) ^ (prev2 >>> 10);
      schedule[index] =
        (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0;
    }
    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index] + schedule[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }
  return Array.from(hash)
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}

function fixed2(value: number | undefined): string {
  return (Number.isFinite(value ?? NaN) ? (value as number) : 0).toFixed(2);
}

/** 旧版 32 位 FNV-1a 校验码（XXXX-XXXX），保留用于验证历史结算单。 */
export function legacySettlementChecksum(settlement: Settlement): string {
  const canonical = [
    settlement.id,
    settlement.jobId,
    settlement.jobName,
    settlement.periodStart,
    settlement.periodEnd,
    settlement.net.toFixed(2),
    settlement.createdAt,
  ].join('|');
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  const hex = hash.toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** 结算内容字段（不含可变的收款字段）。 */
function baseParts(settlement: Settlement): Array<string | number> {
  return [
    settlement.id,
    settlement.jobId,
    settlement.jobName,
    settlement.cycle,
    settlement.periodStart,
    settlement.periodEnd,
    settlement.payType ?? '',
    settlement.monthlyMode ?? '',
    fixed2(settlement.base),
    fixed2(settlement.otPay),
    fixed2(settlement.bonus),
    fixed2(settlement.deduction),
    fixed2(settlement.extraBonus),
    fixed2(settlement.extraDeduction),
    fixed2(settlement.overRestDays),
    fixed2(settlement.overRestDeduction),
    fixed2(settlement.advanceTotal),
    fixed2(settlement.net),
    fixed2(settlement.hours),
    String(settlement.days),
    fixed2(settlement.otHours),
    fixed2(settlement.restDays),
    (settlement.restDates ?? []).join(','),
    settlement.createdAt,
  ];
}

/**
 * 结算校验码 canonical：**不含收款字段**（B04）。
 * 登记收款 / 部分收款后同一张单的结算码保持不变，先前导出的 CSV/PDF 仍能核对。
 */
function canonicalOf(settlement: Settlement): string {
  return baseParts(settlement).join('|');
}

/** 旧版 canonical（含收款字段）：只用于验证 v1.2.5 及更早生成的 sha256 码，以及收款码。 */
function canonicalOfWithPayment(settlement: Settlement): string {
  const parts = baseParts(settlement);
  // 旧版顺序：… otHours, paidAmount, paymentStatus, restDays …
  parts.splice(
    parts.length - 3,
    0,
    fixed2(settlement.paidAmount),
    settlement.paymentStatus ?? '',
  );
  return parts.join('|');
}

/** 新版结算校验码：`sha256:十六位十六进制`（64 位有效位，足够避免偶然碰撞）。 */
export function settlementChecksum(settlement: Settlement): string {
  return `sha256:${sha256Hex(canonicalOf(settlement)).slice(0, 16)}`;
}

/** 收款校验码：包含收款字段，用于单独核对「何时收了多少钱」；与结算码分开（B04）。 */
export function paymentChecksum(settlement: Settlement): string {
  return `sha256:${sha256Hex(canonicalOfWithPayment(settlement)).slice(0, 16)}`;
}

/**
 * 验证校验码：带 `sha256:` 前缀按新算法，旧无前缀码按 FNV 旧算法兼容验证。
 * 用于扫码 / 粘贴核对历史结算单。
 */
export function verifySettlementChecksum(settlement: Settlement, code: string): boolean {
  const value = (code ?? '').trim();
  if (!value) return false;
  if (value.toLowerCase().startsWith('sha256:')) {
    const v2 = settlementChecksum(settlement);
    // 兼容 v1.2.5 及更早生成的「含收款字段」码：同一张单仍可验证。
    const v1 = `sha256:${sha256Hex(canonicalOfWithPayment(settlement)).slice(0, 16)}`;
    return value.toLowerCase() === v2 || value.toLowerCase() === v1;
  }
  return legacySettlementChecksum(settlement) === value.toUpperCase();
}
