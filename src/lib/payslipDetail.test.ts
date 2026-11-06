import { describe, expect, it } from 'vitest';
import type { Settlement } from '../types';
import { buildPayslipDetailRows, chunkPayslipRows } from './payslipDetail';
import { makeEntry, makeSettlement } from './testFixtures';

const settlement = makeSettlement({
  id: 'settlement-detail',
  entryIds: ['entry-2', 'entry-1'],
}) as Settlement;

describe('文字版 PDF 工记明细', () => {
  it('只取本结算单锁定的工记，按日期升序，金额与工时正确', () => {
    const rows = buildPayslipDetailRows(settlement, [
      makeEntry({ id: 'entry-1', date: '2026-11-03', hours: 8 }),
      makeEntry({ id: 'entry-2', date: '2026-11-05', hours: 6 }),
      makeEntry({ id: 'entry-other', date: '2026-11-04', hours: 4 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['entry-1', 'entry-2']);
    expect(rows[0].hours).toBe(8);
    expect(rows[0].amount).toBe(200);
    expect(rows[1].amount).toBe(150);
    expect(rows[0].label).toContain('11月3日');
  });

  it('忽略不属于同一工作的工记', () => {
    const rows = buildPayslipDetailRows(settlement, [
      makeEntry({ id: 'entry-1', jobId: 'job-2', date: '2026-11-03' }),
    ]);
    expect(rows).toEqual([]);
  });

  it('按每页 36 行分页，末页保留余数', () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({
      id: `entry-${index}`,
      date: '2026-11-03',
      label: `${index}`,
      hours: 1,
      amount: 25,
    }));
    const pages = chunkPayslipRows(rows);
    expect(pages.map((page) => page.length)).toEqual([36, 36, 8]);
  });

  it('空明细不生成分页', () => {
    expect(chunkPayslipRows([])).toEqual([]);
  });
});
