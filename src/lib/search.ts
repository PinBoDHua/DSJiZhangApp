import type { Entry, Job } from '../types';
import {
  formatDateCompact,
  formatDateShort,
  parseISODate,
  relativeDayLabel,
  weekdayCN,
} from './date';
import { formatMoney, formatHours } from './money';
import { payForEntry } from './pay';

export interface EntrySearchResult {
  entry: Entry;
  job?: Job;
  /** 该笔工记的折算金额，用于展示与金额搜索 */
  total: number;
}

export interface EntrySearchOptions {
  /** 只看某份工作 */
  jobId?: string;
}

/** 把用户输入拆成关键词；空查询返回空数组。 */
export function tokenizeQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function dateHaystack(iso: string): string {
  const year = iso.slice(0, 4);
  const date = parseISODate(iso);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const monthDay = iso.slice(5);
  return [
    iso,
    iso.replace(/-/g, '/'),
    iso.replace(/-/g, '.'),
    iso.replace(/-/g, ''),
    formatDateCompact(iso),
    formatDateShort(iso),
    `${year}年${month}月`,
    `${month}月${day}日`,
    `${month}-${day}`,
    `${month}.${day}`,
    `${month}/${day}`,
    String(year),
    monthDay,
    monthDay.replace('-', ''),
    weekdayCN(iso),
    relativeDayLabel(iso),
  ].join(' ');
}

function amountHaystack(total: number): string {
  const fixed = total.toFixed(2);
  const plain = formatMoney(total, { symbol: false });
  const symbol = formatMoney(total, { symbol: true });
  const integer = Math.trunc(total).toString();
  const noComma = plain.replace(/,/g, '');
  return [fixed, plain, symbol, noComma, integer].join(' ');
}

/** 单个工记的搜索文本：岗位、雇主、备注、日期、金额、工时。 */
export function entryHaystack(entry: Entry, job?: Job): string {
  const total = payForEntry(entry).total;
  const hours = formatHours(entry.hours || 0);
  return [
    job?.name ?? '',
    job?.employer ?? '',
    entry.note ?? '',
    dateHaystack(entry.date),
    amountHaystack(total),
    String(entry.rule.rate ?? ''),
    hours !== '0' ? `${hours}h` : '',
    entry.holiday ? '法定节假日 节假日' : '',
    entry.otHours > 0 ? '加班' : '',
    entry.bonus > 0 ? '奖金' : '',
    entry.deduction > 0 ? '扣款' : '',
    entry.settlementId ? '已结算' : '未结算',
  ]
    .join(' ')
    .toLowerCase();
}

/** 全量搜索：多关键词 AND，结果按日期倒序。 */
export function searchEntries(
  entries: Entry[],
  jobs: Job[],
  query: string,
  options: EntrySearchOptions = {},
): EntrySearchResult[] {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return [];
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const results: EntrySearchResult[] = [];
  for (const entry of entries) {
    if (options.jobId && entry.jobId !== options.jobId) continue;
    const job = jobMap.get(entry.jobId);
    const haystack = entryHaystack(entry, job);
    if (!terms.every((term) => haystack.includes(term))) continue;
    results.push({ entry, job, total: payForEntry(entry).total });
  }
  results.sort(
    (a, b) =>
      b.entry.date.localeCompare(a.entry.date) ||
      (b.entry.startTime ?? '').localeCompare(a.entry.startTime ?? '') ||
      b.entry.createdAt.localeCompare(a.entry.createdAt),
  );
  return results;
}

/** 搜索结果里实际出现过的岗位，按首次出现顺序返回。 */
export function jobsInResults(results: EntrySearchResult[], jobs: Job[]): Job[] {
  const ids = new Set(results.map((result) => result.entry.jobId));
  return jobs.filter((job) => ids.has(job.id));
}
