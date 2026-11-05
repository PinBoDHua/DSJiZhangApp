import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BATCH_TEMPLATE_KEY,
  deleteBatchTemplate,
  loadBatchTemplates,
  normalizeBatchTemplates,
  saveBatchTemplates,
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
      { id: 'a', name: '常规', hours: 6, bonus: 20, deduction: 5, note: '夜班' },
      { id: 'b', name: '无工时', hours: 0, bonus: 1 },
      { id: 'c', name: '坏数据', hours: 'x' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      hours: 6,
      bonus: 20,
      deduction: 5,
      note: '夜班',
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
});
