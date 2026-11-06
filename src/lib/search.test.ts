import { describe, expect, it } from 'vitest';
import { makeEntry, makeJob } from './testFixtures';
import {
  entryHaystack,
  jobsInResults,
  searchEntries,
  tokenizeQuery,
} from './search';

const job = makeJob({
  id: 'job-1',
  name: '顺丰夜班',
  employer: '顺丰速运',
  rule: {
    ...makeJob().rule,
    rate: 25,
    standardHours: 8,
    otEnabled: false,
  },
});

const otherJob = makeJob({
  id: 'job-2',
  name: '城南工地',
  employer: '三建',
});

const entries = [
  makeEntry({
    id: 'e-1',
    jobId: 'job-1',
    date: '2026-11-06',
    note: '夜班分拣加急',
    hours: 8,
    createdAt: '2026-11-06T10:00:00.000Z',
  }),
  makeEntry({
    id: 'e-2',
    jobId: 'job-2',
    date: '2026-10-15',
    note: '搬水泥',
    hours: 10,
    rule: { ...makeJob().rule, payType: 'daily', rate: 320, otEnabled: false },
    createdAt: '2026-10-15T10:00:00.000Z',
  }),
  makeEntry({
    id: 'e-3',
    jobId: 'job-1',
    date: '2026-09-01',
    note: 'September shift',
    hours: 4,
    createdAt: '2026-09-01T10:00:00.000Z',
  }),
];

describe('搜索关键词', () => {
  it('空查询返回空数组，不返回全部', () => {
    expect(tokenizeQuery('   ')).toEqual([]);
    expect(searchEntries(entries, [job, otherJob], '   ')).toEqual([]);
  });

  it('按备注、岗位、雇主匹配', () => {
    expect(searchEntries(entries, [job, otherJob], '分拣').map((item) => item.entry.id)).toEqual([
      'e-1',
    ]);
    expect(searchEntries(entries, [job, otherJob], '顺丰').map((item) => item.entry.id)).toEqual([
      'e-1',
      'e-3',
    ]);
    expect(searchEntries(entries, [job, otherJob], '三建').map((item) => item.entry.id)).toEqual([
      'e-2',
    ]);
  });

  it('多个关键词按 AND 匹配', () => {
    expect(searchEntries(entries, [job, otherJob], '顺丰 分拣').map((item) => item.entry.id)).toEqual([
      'e-1',
    ]);
    expect(searchEntries(entries, [job, otherJob], '顺丰 搬水泥')).toEqual([]);
  });

  it('英文备注不区分大小写', () => {
    expect(searchEntries(entries, [job, otherJob], 'SEPTEMBER').map((item) => item.entry.id)).toEqual([
      'e-3',
    ]);
  });

  it('支持多种日期写法', () => {
    const ids = (query: string) =>
      searchEntries(entries, [job, otherJob], query).map((item) => item.entry.id);
    expect(ids('2026-11-06')).toEqual(['e-1']);
    expect(ids('11-06')).toEqual(['e-1']);
    expect(ids('11-6')).toEqual(['e-1']);
    expect(ids('11.06')).toEqual(['e-1']);
    expect(ids('11月6日')).toEqual(['e-1']);
    expect(ids('2026年11月')).toEqual(['e-1']);
    expect(ids('2026-09')).toEqual(['e-3']);
  });

  it('支持按金额搜索', () => {
    const ids = (query: string) =>
      searchEntries(entries, [job, otherJob], query).map((item) => item.entry.id);
    // e-1: 8h × 25 = 200；e-2: 日薪 320。固定月薪 / 时薪不改变其它记录。
    expect(ids('200')).toEqual(['e-1']);
    expect(ids('200.00')).toEqual(['e-1']);
    expect(ids('¥200')).toEqual(['e-1']);
    expect(ids('320')).toEqual(['e-2']);
    expect(ids('25')).toEqual(['e-1', 'e-3']);
  });

  it('支持按工时搜索', () => {
    expect(
      searchEntries(entries, [job, otherJob], '10h').map((item) => item.entry.id),
    ).toEqual(['e-2']);
  });

  it('按岗位筛选', () => {
    expect(
      searchEntries(entries, [job, otherJob], '2026', { jobId: 'job-2' }).map(
        (item) => item.entry.id,
      ),
    ).toEqual(['e-2']);
  });

  it('结果按日期倒序', () => {
    expect(searchEntries(entries, [job, otherJob], '20').map((item) => item.entry.id)).toEqual([
      'e-1',
      'e-2',
      'e-3',
    ]);
  });

  it('搜索文本包含金额、岗位和日期，不包含无关工作', () => {
    const haystack = entryHaystack(entries[0], job);
    expect(haystack).toContain('顺丰夜班');
    expect(haystack).toContain('夜班分拣加急');
    expect(haystack).toContain('2026-11-06');
    expect(haystack).toContain('200');
    expect(haystack).not.toContain('城南工地');
  });

  it('jobsInResults 只返回命中的岗位且保持原顺序', () => {
    const results = searchEntries(entries, [job, otherJob], '顺丰');
    expect(jobsInResults(results, [job, otherJob]).map((item) => item.id)).toEqual(['job-1']);
  });
});
