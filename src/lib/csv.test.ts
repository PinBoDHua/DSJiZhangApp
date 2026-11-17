import { describe, expect, it } from 'vitest';
import type { Entry, Job, PayRule, Period, RestDay } from '../types';
import { makeSettlement } from './testFixtures';
import { buildAttendanceCsv, buildCsv, buildEntryCsv, buildSettlementCsv } from './csv';

const rule = {
  payType: 'monthly',
  rate: 3500,
  standardHours: 6,
  expectedDays: 22,
  monthlyMode: 'fixed',
  restDaysPerMonth: 5,
  restPolicy: 'quota',
  overRestDeduct: false,
  overRestDailyRate: 0,
  unitLabel: '件',
  otEnabled: false,
  weekdayOT: 1.5,
  weekendOT: 2,
  holidayOT: 3,
} as PayRule;

const job = (id: string, name: string): Job =>
  ({
    id,
    name,
    color: 'pine',
    rule,
    shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
    cycle: 'monthly',
    archived: false,
    createdAt: '2026-11-01T00:00:00.000Z',
  }) as Job;

const entry = (jobId: string, date: string, hours: number): Entry =>
  ({
    id: `entry-${jobId}-${date}`,
    jobId,
    date,
    breakMinutes: 0,
    hours,
    quantity: 0,
    otHours: 0,
    bonus: 0,
    deduction: 0,
    holiday: false,
    rule,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
  }) as Entry;

const rest = (jobId: string, date: string, days: number): RestDay => ({
  id: `rest-${jobId}-${date}`,
  jobId,
  date,
  days,
  createdAt: `${date}T12:00:00.000Z`,
});

const period: Period = {
  start: '2026-11-01',
  end: '2026-11-03',
  key: 'monthly:2026-11',
  label: '2026年11月',
  shortLabel: '11月',
};

describe('月度考勤 CSV', () => {
  it('按日期 × 岗位导出班 / 休 / 未记，并带 BOM', () => {
    const csv = buildAttendanceCsv(
      [job('j1', '老宅装修'), job('j2', '城南工地')],
      [entry('j1', '2026-11-01', 6), entry('j2', '2026-11-01', 8)],
      [rest('j1', '2026-11-02', 0.5)],
      period,
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('日期,星期,老宅装修,城南工地,当日工时');
    expect(csv).toContain('2026-11-01,周日,班 6h,班 8h,14');
    expect(csv).toContain('2026-11-02,周一,休 0.5,未记,0');
    expect(csv).toContain('2026-11-03,周二,未记,未记,0');
    expect(csv).toContain('合计,,1 班 / 0.5 休 / 6h,1 班 / 0 休 / 8h,14');
  });
});

describe('CSV 转义', () => {
  it('公式前缀、逗号、换行和回车都会转义', () => {
    expect(buildCsv([['=1+1', '@cmd', '+86', '-1+2']])).toBe(
      "'=1+1,'@cmd,'+86,'-1+2",
    );
    expect(buildCsv([['a,b', 'c"d', 'e\nf', 'g\rh']])).toBe('"a,b","c""d","e\nf","g\rh"');
    // 数字不算文本，保持原样，不会误加撇号。
    expect(buildCsv([[42, -1, 1.5]])).toBe('42,-1,1.5');
  });

  it('完整工记 CSV 的备注转义后列数不变', () => {
    const messy = {
      ...entry('j1', '2026-11-01', 6),
      note: '=HYPERLINK("http://x"),\n第二行',
    } as Entry;
    const csv = buildEntryCsv([messy], [job('j1', '老宅装修')]);
    const [header, row] = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(header.split(',').length).toBeGreaterThan(30);
    expect(row.startsWith('entry-j1-2026-11-01,')).toBe(true);
    expect(row).toContain('"\'=HYPERLINK(""http://x""),\n第二行"');
  });
});
describe('数字舍入与公式注入', () => {
  it('number 一律先舍入到分，浮点尾数不进文件（PAY-04）', () => {
    expect(buildCsv([[0.1 + 0.2]])).toBe('0.3');
    expect(buildCsv([[1.005]])).toBe('1.01');
    expect(buildCsv([[2.675, -0.30000000000000004]])).toBe('2.68,-0.3');
  });

  it('Tab 前导公式与以引号开头的文本仍按文本处理', () => {
    expect(buildCsv([['\t=1+1']])).toBe("'\t=1+1");
    expect(buildCsv([['"=1+1']])).toBe('"""=1+1"');
  });
});

describe('结算 CSV', () => {
  it('奖金 / 扣款与 Excel 同语义，额外奖扣单列，并带单号 / 校验码（PAY-18）', () => {
    const settlement = makeSettlement({
      id: 'settlement-csv',
      jobName: '城南工地',
      base: 200,
      bonus: 0.1,
      extraBonus: 0.2,
      deduction: 0.1,
      extraDeduction: 0.2,
      net: 200,
      hours: 8,
      days: 1,
      entryIds: ['entry-1'],
    });
    const [header, row] = buildSettlementCsv([settlement]).replace(/^\uFEFF/, '').split('\r\n');
    const columns = header.split(',');
    const cellOf = (name: string) => row.split(',')[columns.indexOf(name)];
    expect(columns).toContain('单号');
    expect(columns).toContain('校验码');
    expect(cellOf('单号')).toBe('settlement-csv');
    expect(cellOf('奖金')).toBe('0.1');
    expect(cellOf('额外奖金')).toBe('0.2');
    expect(cellOf('扣款')).toBe('0.1');
    expect(cellOf('额外扣款')).toBe('0.2');
    expect(cellOf('校验码')).toMatch(/^sha256:[0-9a-f]{16}$/);
    // 合计列也不该出现浮点尾数。
    expect(row).not.toContain('30000000000000004');
  });
});

