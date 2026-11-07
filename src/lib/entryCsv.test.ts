import { describe, expect, it } from 'vitest';
import { buildEntryCsv } from './csv';
import { makeEntry, makeJob } from './testFixtures';

describe('完整工记 CSV', () => {
  it('包含完整计薪快照、来源与参考金额，并支持筛选', () => {
    const job = makeJob({ name: '夜班', employer: '仓库' });
    const entry = makeEntry({ recurringRuleId: 'rule-1', note: '正常' });
    const csv = buildEntryCsv([entry], [job]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.split('\r\n')[0].split(',')).toHaveLength(38);
    expect(csv).toContain('记录ID');
    expect(csv).toContain('周期规则ID');
    expect(csv).toContain('entry-1');
    expect(csv).toContain('rule-1');
    expect(csv).toContain('合计(单笔折算参考)');
    expect(buildEntryCsv([entry], [job], { start: '2026-11-03' }).split('\r\n')).toHaveLength(1);
    expect(buildEntryCsv([entry], [job], { jobId: 'missing' }).split('\r\n')).toHaveLength(1);
  });

  it('文本字段不会被 Excel / WPS 当作公式执行', () => {
    const job = makeJob({ name: '+危险工作' });
    const entry = makeEntry({ note: '=1+1' });
    const csv = buildEntryCsv([entry], [job]);
    expect(csv).toContain("'+危险工作");
    expect(csv).toContain("'=1+1");
  });
});
