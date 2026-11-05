import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BATCH_TEMPLATE_KEY,
  deleteBatchTemplate,
  loadBatchTemplates,
  mergeBatchTemplates,
  normalizeBatchTemplates,
  parseBatchTemplateFile,
  saveBatchTemplates,
  serializeBatchTemplates,
  upsertBatchTemplate,
  type BatchTemplate,
} from './batchTemplates';

const memory = new Map<string, string>();

beforeEach(() => {
  memory.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
});

describe('批量补记常用模板', () => {
  it('过滤无效工时并归一化金额', () => {
    const result = normalizeBatchTemplates([
      {
        id: 'a',
        name: '常规',
        hours: 6,
        bonus: 20,
        deduction: 5,
        note: '夜班',
        jobId: 'job-1',
        jobName: '老宅装修',
      },
      { id: 'b', name: '无工时', hours: 0, bonus: 1 },
      { id: 'c', name: '坏数据', hours: 'x' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hours: 6,
      bonus: 20,
      deduction: 5,
      note: '夜班',
      jobId: 'job-1',
      jobName: '老宅装修',
    });
  });

  it('同名模板覆盖，最多保留 8 个', () => {
    let templates: BatchTemplate[] = [];
    for (let index = 0; index < 10; index += 1) {
      const result = upsertBatchTemplate(templates, {
        name: `模板${index}`,
        hours: 6,
        bonus: 0,
        deduction: 0,
        note: '',
      });
      templates = result.templates;
    }
    expect(templates).toHaveLength(8);
    const replaced = upsertBatchTemplate(templates, {
      name: '模板9',
      hours: 8,
      bonus: 10,
      deduction: 2,
      note: '改过',
    });
    expect(replaced.templates).toHaveLength(8);
    expect(replaced.templates.filter((item) => item.name === '模板9')).toHaveLength(1);
    expect(replaced.saved.hours).toBe(8);
  });

  it('保存、读取、删除模板', () => {
    const saved = saveBatchTemplates([
      {
        id: 'tpl-1',
        name: '6h 常规',
        hours: 6,
        bonus: 0,
        deduction: 0,
        note: '',
      },
    ]);
    expect(saved).toHaveLength(1);
    expect(loadBatchTemplates()).toHaveLength(1);
    expect(deleteBatchTemplate(saved, 'tpl-1')).toEqual([]);
    expect(loadBatchTemplates()).toEqual([]);
  });

  it('同名模板按岗位区分', () => {
    const first = upsertBatchTemplate([], {
      name: '夜班',
      hours: 7,
      bonus: 10,
      deduction: 0,
      note: '',
      jobId: 'job-a',
      jobName: 'A 工地',
    });
    const second = upsertBatchTemplate(first.templates, {
      name: '夜班',
      hours: 9,
      bonus: 20,
      deduction: 2,
      note: '',
      jobId: 'job-b',
      jobName: 'B 工地',
    });
    expect(second.templates).toHaveLength(2);
    expect(
      second.templates.filter(
        (item) => item.name === '夜班' && item.jobId === 'job-a',
      ),
    ).toHaveLength(1);
  });

  it('模板 JSON 可导出、导入并合并', () => {
    const templates = [
      {
        id: 'tpl-a',
        name: '夜班',
        hours: 7,
        bonus: 20,
        deduction: 5,
        note: '夜间',
        jobId: 'job-a',
        jobName: 'A 工地',
      },
    ];
    const text = serializeBatchTemplates(templates);
    expect(text).toContain('"kind": "batch-templates"');
    const parsed = parseBatchTemplateFile(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].jobName).toBe('A 工地');
    const merged = mergeBatchTemplates(
      [{ ...templates[0], id: 'local', name: '白班', hours: 6 }],
      parsed,
    );
    expect(merged).toHaveLength(2);
    expect(() => parseBatchTemplateFile('{"app":"xinshi","kind":"other"}')).toThrow(
      '不是薪时批量模板文件',
    );
  });
});
