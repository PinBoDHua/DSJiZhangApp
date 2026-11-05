import { createId } from './id';

export const BATCH_TEMPLATE_KEY = 'xinshi.batchTemplates';
const MAX_TEMPLATES = 8;

export interface BatchTemplate {
  id: string;
  name: string;
  hours: number;
  bonus: number;
  deduction: number;
  note: string;
  jobId?: string;
  jobName?: string;
}

export interface BatchTemplateFile {
  app: 'xinshi';
  kind: 'batch-templates';
  version: 1;
  templates: BatchTemplate[];
}

function asAmount(value: unknown, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(max, Math.max(0, Math.round(number * 100) / 100));
}

export function normalizeBatchTemplates(value: unknown): BatchTemplate[] {
  if (!Array.isArray(value)) return [];
  const result: BatchTemplate[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : createId('tpl');
    if (seen.has(id)) continue;
    const hours = asAmount(raw.hours, 24);
    if (hours <= 0) continue;
    const name =
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 30)
        : `${hours}h/天`;
    result.push({
      id,
      name,
      hours,
      bonus: asAmount(raw.bonus, 1_000_000),
      deduction: asAmount(raw.deduction, 1_000_000),
      note:
        typeof raw.note === 'string' ? raw.note.trim().slice(0, 40) : '',
      jobId: typeof raw.jobId === 'string' && raw.jobId ? raw.jobId : undefined,
      jobName:
        typeof raw.jobName === 'string' && raw.jobName
          ? raw.jobName.trim().slice(0, 30)
          : undefined,
    });
    seen.add(id);
  }
  return result.slice(0, MAX_TEMPLATES);
}

export function loadBatchTemplates(): BatchTemplate[] {
  try {
    const raw = localStorage.getItem(BATCH_TEMPLATE_KEY);
    return raw ? normalizeBatchTemplates(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function saveBatchTemplates(templates: BatchTemplate[]): BatchTemplate[] {
  const normalized = normalizeBatchTemplates(templates);
  try {
    localStorage.setItem(BATCH_TEMPLATE_KEY, JSON.stringify(normalized));
  } catch {
    // 偏好存不下不影响本批补记。
  }
  return normalized;
}

export function upsertBatchTemplate(
  templates: BatchTemplate[],
  input: Omit<BatchTemplate, 'id'>,
): { templates: BatchTemplate[]; saved: BatchTemplate } {
  const saved: BatchTemplate = { ...input, id: createId('tpl') };
  const next = [
    saved,
    ...templates.filter(
      (item) => item.name !== saved.name || item.jobId !== saved.jobId,
    ),
  ].slice(0, MAX_TEMPLATES);
  return { templates: saveBatchTemplates(next), saved };
}

export function deleteBatchTemplate(
  templates: BatchTemplate[],
  id: string,
): BatchTemplate[] {
  return saveBatchTemplates(templates.filter((item) => item.id !== id));
}

export function serializeBatchTemplates(templates: BatchTemplate[]): string {
  const payload: BatchTemplateFile = {
    app: 'xinshi',
    kind: 'batch-templates',
    version: 1,
    templates: normalizeBatchTemplates(templates),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBatchTemplateFile(text: string): BatchTemplate[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('模板文件不是有效的 JSON');
  }
  const wrapper =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (wrapper && wrapper.kind && wrapper.kind !== 'batch-templates') {
    throw new Error('这不是薪时批量模板文件');
  }
  if (wrapper && typeof wrapper.version === 'number' && wrapper.version > 1) {
    throw new Error('模板文件版本过高，请升级 App');
  }
  const source = Array.isArray(raw)
    ? raw
    : wrapper && Array.isArray(wrapper.templates)
      ? wrapper.templates
      : null;
  if (!source) throw new Error('模板文件缺少 templates');
  const templates = normalizeBatchTemplates(source);
  if (templates.length === 0) throw new Error('模板文件里没有可用模板');
  return templates;
}

export function mergeBatchTemplates(
  existing: BatchTemplate[],
  imported: BatchTemplate[],
): BatchTemplate[] {
  const map = new Map<string, BatchTemplate>();
  for (const item of existing) {
    map.set(`${item.jobId ?? ''}::${item.name}`, item);
  }
  for (const item of imported) {
    map.set(`${item.jobId ?? ''}::${item.name}`, {
      ...item,
      id: createId('tpl'),
    });
  }
  return saveBatchTemplates([...map.values()].slice(0, MAX_TEMPLATES));
}
