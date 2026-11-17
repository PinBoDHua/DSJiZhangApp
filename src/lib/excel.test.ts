import { describe, expect, it } from 'vitest';
import { buildLedgerSheets, excelFileName } from './excel';
import { baseRule } from './testFixtures';
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
    expect(sheets[0].rows[0][11]).toBe('基础工资(单日仅计一次)');
    expect(sheets[0].rows[0][15]).toBe('合计(单笔折算参考)');
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

  it('已结算周期内的休息日不再重复计入未结汇总', () => {
    const job = makeJob();
    const settledEntry = makeEntry({
      id: 'entry-s',
      date: '2026-11-02',
      settlementId: 'settlement-1',
    });
    const openEntry = makeEntry({ id: 'entry-o', date: '2026-11-10' });
    const settlement = makeSettlement({
      id: 'settlement-1',
      periodStart: '2026-11-02',
      periodEnd: '2026-11-08',
      restDays: 1,
      restDates: ['2026-11-03'],
      entryIds: [settledEntry.id],
    });
    const state = makeState({
      jobs: [job],
      entries: [settledEntry, openEntry],
      settlements: [settlement],
      restDays: [
        makeRestDay({ id: 'rest-in', date: '2026-11-03' }),
        makeRestDay({ id: 'rest-out', date: '2026-11-12', days: 0.5 }),
      ],
    });
    const summary = buildLedgerSheets(state)[1].rows;
    const open = summary.find((row) => row[14] === '未结（预估）');
    expect(open?.[3]).toBe(0.5);
    const settled = summary.find((row) => row[14] === '已结');
    expect(settled?.[3]).toBe(1);
  });

  it('孤儿 settlementId 的工记明细标未结算，与汇总口径一致', () => {
    const job = makeJob();
    const orphan = makeEntry({ id: 'entry-orphan', settlementId: 'settlement-gone' });
    const state = makeState({ jobs: [job], entries: [orphan], settlements: [] });
    const sheets = buildLedgerSheets(state);
    expect(sheets[0].rows[1][17]).toBe('未结算');
    expect(sheets[0].rows[1][18]).toBe('');
    const open = sheets[1].rows.find((row) => row[14] === '未结（预估）');
    expect(open?.[2]).toBe(1);
  });
});
describe('未结预估与明细口径（PAY-06）', () => {
  const fixedRule = {
    ...baseRule,
    payType: 'monthly' as const,
    rate: 3500,
    expectedDays: 22,
    monthlyMode: 'fixed' as const,
    otEnabled: false,
  };

  it('未结（预估）行按岗位 × 结算周期逐期汇总，并扣未结借支', () => {
    const job = makeJob({ cycle: 'weekly', rule: fixedRule });
    const state = makeState({
      jobs: [job],
      entries: [
        makeEntry({ id: 'w-1', jobId: job.id, date: '2026-11-03', hours: 6, rule: fixedRule }),
        makeEntry({ id: 'w-2', jobId: job.id, date: '2026-11-04', hours: 6, rule: fixedRule }),
      ],
      advances: [makeAdvance({ id: 'adv-1', jobId: job.id, date: '2026-11-01', amount: 100 })],
    });
    const summary = buildLedgerSheets(state)[1].rows;
    const open = summary.find((row) => row[14] === '未结（预估）');
    // 一周 2 天 = 318.18（不再是整月 3500），借支 100 抵扣后应发 218.18。
    expect(open?.[6]).toMatchObject({ value: 318.18, style: 'money' });
    expect(open?.[11]).toMatchObject({ value: 100, style: 'money' });
    expect(open?.[13]).toMatchObject({ value: 218.18, style: 'money' });
  });

  it('明细表同日多段日薪只计一次基础工资', () => {
    const dailyRule = { ...baseRule, payType: 'daily' as const, rate: 300, otEnabled: false };
    const job = makeJob({ cycle: 'weekly', rule: dailyRule });
    const state = makeState({
      jobs: [job],
      entries: [
        makeEntry({ id: 'd-1', jobId: job.id, date: '2026-11-03', hours: 4, rule: dailyRule }),
        makeEntry({
          id: 'd-2',
          jobId: job.id,
          date: '2026-11-03',
          hours: 4,
          createdAt: '2026-11-03T13:00:00.000Z',
          rule: dailyRule,
        }),
      ],
    });
    const detail = buildLedgerSheets(state)[0].rows.slice(1);
    const baseSum = detail.reduce(
      (sum, row) => sum + (typeof row[11] === 'object' && row[11] ? Number(row[11].value) : 0),
      0,
    );
    const totalSum = detail.reduce(
      (sum, row) => sum + (typeof row[15] === 'object' && row[15] ? Number(row[15].value) : 0),
      0,
    );
    expect(baseSum).toBe(300);
    expect(totalSum).toBe(300);
  });

  it('旧结算单只有 restDates 时按休息记录求和，半天不再算整天', () => {
    const settlement = makeSettlement({
      id: 'settlement-old',
      restDates: ['2026-11-03', '2026-11-04'],
      entryIds: [],
    });
    const state = makeState({
      jobs: [makeJob()],
      settlements: [settlement],
      restDays: [
        makeRestDay({ id: 'r-half', date: '2026-11-03', days: 0.5 }),
        makeRestDay({ id: 'r-full', date: '2026-11-04', days: 1 }),
      ],
    });
    const summary = buildLedgerSheets(state)[1].rows;
    const settled = summary.find((row) => row[14] === '已结');
    expect(settled?.[3]).toBe(1.5);
  });
});

