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
    ...templates.filter((item) => item.name !== saved.name),
  ].slice(0, MAX_TEMPLATES);
  return { templates: saveBatchTemplates(next), saved };
}

export function deleteBatchTemplate(
  templates: BatchTemplate[],
  id: string,
): BatchTemplate[] {
  return saveBatchTemplates(templates.filter((item) => item.id !== id));
}
