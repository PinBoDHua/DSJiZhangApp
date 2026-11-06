import type { Entry, Settlement } from '../types';
import { formatDateShort, weekdayShort } from './date';
import { round2 } from './money';
import { payForEntry } from './pay';

export const DETAIL_ROWS_PER_PAGE = 36;

export interface PayslipDetailRow {
  id: string;
  date: string;
  label: string;
  hours: number;
  amount: number;
  note?: string;
}

/** 结算单明细：只取这张结算单锁定过的工记，按日期升序 */
export function buildPayslipDetailRows(
  settlement: Settlement,
  entries: Entry[],
): PayslipDetailRow[] {
  const ids = new Set(settlement.entryIds);
  return entries
    .filter((entry) => ids.has(entry.id) && entry.jobId === settlement.jobId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((entry) => ({
      id: entry.id,
      date: entry.date,
      label: `${formatDateShort(entry.date)} ${weekdayShort(entry.date)}`,
      hours: round2(entry.hours || 0),
      amount: round2(payForEntry(entry).total),
      note: entry.note,
    }));
}

export function chunkPayslipRows(
  rows: PayslipDetailRow[],
  perPage = DETAIL_ROWS_PER_PAGE,
): PayslipDetailRow[][] {
  const size = Math.max(1, perPage);
  const pages: PayslipDetailRow[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    pages.push(rows.slice(index, index + size));
  }
  return pages;
}
