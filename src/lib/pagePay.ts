import type { Cycle, Entry, Settlement } from '../types';
import { formatRestDays } from './rest';
import { round2 } from './money';

/**
 * 页面层与计薪口径对齐的纯逻辑（审计第二波 PAY-05/20/21/27/28、UI-10/33）。
 * 只做判断与文案，不依赖 React，方便单测钉住行为。
 */

/** 奖金 / 扣款录入上限：与 lib/storage.ts 的 IMPORT_LIMITS.money 同值（UI-10）。 */
export const MONEY_INPUT_LIMIT = 1_000_000;

/** 按导入同口径钳制：负数归零、超过上限截到上限、NaN/Infinity 归零。 */
export function clampMoneyInput(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MONEY_INPUT_LIMIT, Math.max(0, round2(value)));
}

/** 是否超过导入上限，页面据此报错而不是静默改数（UI-10）。 */
export function moneyInputTooLarge(value: number): boolean {
  return Number.isFinite(value) && value > MONEY_INPUT_LIMIT;
}

/** 当天合计工时是否超过 24 小时；带 1e-9 容差，避免 8.1 + 15.9 这类浮点误拒（UI-33）。 */
export function exceedsDailyHours(dayHours: number, adding: number): boolean {
  return dayHours + adding > 24 + 1e-9;
}

function compareLatestEntry(a: Entry, b: Entry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * 月薪明细是否横跨了不同的计薪快照（PAY-20）。
 * 与 settlement.ts 的封顶口径同语义：按「每天最新快照」比较 monthlyMode / rate / expectedDays，
 * 同一天多段工记只取最新一条，且不依赖入参数组顺序。
 */
export function monthlyTermsVary(entries: Entry[]): boolean {
  const latestByDate = new Map<string, Entry>();
  for (const entry of entries) {
    if (entry.rule.payType !== 'monthly') continue;
    const current = latestByDate.get(entry.date);
    if (!current || compareLatestEntry(entry, current) >= 0) {
      latestByDate.set(entry.date, entry);
    }
  }
  const dailyRules = Array.from(latestByDate.values());
  const first = dailyRules[0];
  if (!first) return false;
  return dailyRules.some(
    (entry) =>
      entry.rule.monthlyMode !== first.rule.monthlyMode ||
      entry.rule.rate !== first.rule.rate ||
      entry.rule.expectedDays !== first.rule.expectedDays,
  );
}

/**
 * 固定月薪是否按整月发放（PAY-21）：
 * 只有月结岗位才按整月发放；周结 / 日结的固定月薪按周期折算，文案不能宣称「整月」。
 */
export function fixedMonthlyWholeMonth(cycles: Array<Cycle | undefined>): boolean {
  return cycles.length > 0 && cycles.every((cycle) => cycle === 'monthly');
}

/** 已结算工记 id 集合：直接取结算单 entryIds 并集，与 Excel / 汇总同口径（PAY-27）。 */
export function settledEntryIds(settlements: Settlement[]): Set<string> {
  const ids = new Set<string>();
  for (const settlement of settlements) {
    for (const entryId of settlement.entryIds) ids.add(entryId);
  }
  return ids;
}

/**
 * 撤销结算会丢失的收款登记说明（PAY-28）。
 * 没有收款登记时返回 null；净额 ≤ 0 的「0 元标记结清」不算收款，不提示。
 * C08：hideAmounts 为真时不输出收款额，避免隐藏金额在撤销确认框里被明文暴露。
 */
export function undoLostPaymentNotice(
  settlement: Settlement,
  hideAmounts = false,
): string | null {
  const paid = round2(Math.max(0, settlement.paidAmount ?? 0));
  if (paid <= 0) return null;
  const method = settlement.paymentMethod ? ` · ${settlement.paymentMethod}` : '';
  const when = settlement.paidAt ? `（${settlement.paidAt}${method}）` : '';
  const amount = hideAmounts ? '（金额已隐藏）' : ` ¥${paid}`;
  return `这张结算单已登记收款${amount}${when}，撤销后收款登记会一并丢失，需要重新登记。`;
}

/** 超休区块展示口径（PAY-02）：非整月周期额度按当期折算展示，且不自动扣款。 */
export interface OverRestDisplay {
  /** 本期实际折算额度（整月周期等于月休额度） */
  quota: number;
  /** 额度文案：整月说「月休额度」，非整月说「本期折算额度」 */
  quotaText: string;
  /** 是否按整月口径自动扣超休 */
  autoDeduct: boolean;
  /** 非整月周期只提示不扣款的说明；整月周期为 null */
  notice: string | null;
}

export function overRestDisplay(
  draft: { overRestQuotaDays?: number; overRestAutoDeduction?: boolean },
  monthlyQuota: number,
): OverRestDisplay {
  const autoDeduct = draft.overRestAutoDeduction !== false;
  const quota = draft.overRestQuotaDays ?? monthlyQuota;
  return {
    quota,
    quotaText: autoDeduct
      ? `月休额度 ${formatRestDays(monthlyQuota)} 天`
      : `本期折算额度 ${formatRestDays(quota)} 天`,
    autoDeduct,
    notice: autoDeduct
      ? null
      : '非整月结算周期不自动扣超休，仅提示，请按整月核对',
  };
}
