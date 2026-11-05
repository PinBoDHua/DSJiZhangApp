import { describe, expect, it } from 'vitest';
import { buildLedgerSheets, excelFileName } from './excel';
import { makeAdvance, makeEntry, makeJob, makeRestDay, makeSettlement, makeState } from './testFixtures';

describe('Excel 对账表', () => {
  it('生成四张表并按结算 / 未结分组', () => {
    const job = makeJob({ name: '门店兼职' });
    const settledEntry = makeEntry({
      id: 'entry-1',
      date: '2026-11-02',
      settlementId: 'settlement-1',
    });
    const openEntry = makeEntry({ id: 'entry-2', date: '2026-11-03', hours: 6 });
    const settlement = makeSettlement({
      id: 'settlement-1',
      base: 200,
      net: 200,
      hours: 8,
      days: 1,
      entryIds: [settledEntry.id],
    });
    const state = makeState({
      jobs: [job],
      entries: [settledEntry, openEntry],
      settlements: [settlement],
      advances: [makeAdvance()],
      restDays: [makeRestDay()],
    });

    const sheets = buildLedgerSheets(state);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['工记明细', '月度汇总', '结算单', '借支']);
    expect(sheets[0].rows).toHaveLength(3);
    expect(sheets[0].rows[0][0]).toBe('日期');
    expect(sheets[0].rows[1][0]).toBe('2026-11-02');
    expect(sheets[0].rows[1][15]).toMatchObject({ value: 200, style: 'money' });
    expect(sheets[0].rows[2][7]).toMatchObject({ value: 6, style: 'hours' });

    const summary = sheets[1].rows;
    expect(summary).toHaveLength(3);
    const settled = summary.find((row) => row[14] === '已结');
    expect(settled?.[1]).toBe('门店兼职');
    expect(settled?.[13]).toMatchObject({ value: 200, style: 'money' });
    const open = summary.find((row) => row[14] === '未结（预估）');
    expect(open?.[2]).toBe(1);
    expect(open?.[3]).toBe(0.5 + 0.5);

    expect(sheets[2].rows).toHaveLength(2);
    expect(sheets[2].rows[1][11]).toMatchObject({ value: 200, style: 'money' });
    expect(sheets[2].rows[1][14]).toBe('待发');
    expect(sheets[3].rows).toHaveLength(2);
    expect(sheets[3].rows[1][3]).toBe('未抵扣');
  });

  it('文件名带日期', () => {
    expect(excelFileName(new Date(2026, 10, 5))).toBe('薪时账本-20261105.xlsx');
  });
});
