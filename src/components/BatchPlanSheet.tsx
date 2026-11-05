import { useEffect, useState } from 'react';
import { Check, ClipboardList } from 'lucide-react';
import type { Entry, Job, RestDay, Settlement } from '../types';
import {
  addDays,
  eachDay,
  formatDateShort,
  todayISO,
  weekdayShort,
} from '../lib/date';
import { formatHours } from '../lib/money';
import { planStatusForJob } from '../lib/plan';
import {
  plannedEntryHours,
  type PlannedEntryOptions,
} from '../lib/planEntries';
import {
  deleteBatchTemplate,
  loadBatchTemplates,
  upsertBatchTemplate,
  type BatchTemplate,
} from '../lib/batchTemplates';
import { Sheet } from './Sheet';

interface PlanItem {
  date: string;
  options: PlannedEntryOptions;
}

interface BatchPlanSheetProps {
  open: boolean;
  job: Job | undefined;
  entries: Entry[];
  restDays: RestDay[];
  settlements: Settlement[];
  onClose: () => void;
  onGenerate: (items: PlanItem[]) => void;
}

interface DayOverride {
  hours: string;
  bonus: string;
  deduction: string;
}

const PRESETS = [7, 14, 30];
const EMPTY_OVERRIDE: DayOverride = { hours: '', bonus: '', deduction: '' };

export function BatchPlanSheet({
  open,
  job,
  entries,
  restDays,
  settlements,
  onClose,
  onGenerate,
}: BatchPlanSheetProps) {
  const today = todayISO();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 29));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [hoursInput, setHoursInput] = useState('');
  const [bonusInput, setBonusInput] = useState('0');
  const [deductionInput, setDeductionInput] = useState('0');
  const [overrides, setOverrides] = useState<Record<string, DayOverride>>({});
  const [templates, setTemplates] = useState<BatchTemplate[]>(loadBatchTemplates);
  const [templateId, setTemplateId] = useState('');

  const isCandidate = (date: string) => {
    if (!job) return false;
    if (planStatusForJob(job, date, entries, restDays) !== 'work') return false;
    return !settlements.some(
      (settlement) =>
        settlement.jobId === job.id &&
        date >= settlement.periodStart &&
        date <= settlement.periodEnd,
    );
  };

  useEffect(() => {
    if (!open || !job) return;
    const defaultEnd = addDays(today, 29);
    setStart(today);
    setEnd(defaultEnd);
    setNote('');
    setHoursInput(String(plannedEntryHours(job)));
    setBonusInput('0');
    setDeductionInput('0');
    setOverrides({});
    setTemplateId('');
    setTemplates(loadBatchTemplates());
    setSelected(
      new Set(
        eachDay(today, defaultEnd).filter((date) => {
          if (planStatusForJob(job, date, entries, restDays) !== 'work') return false;
          return !settlements.some(
            (settlement) =>
              settlement.jobId === job.id &&
              date >= settlement.periodStart &&
              date <= settlement.periodEnd,
          );
        }),
      ),
    );
    // 打开弹层时回到默认范围；打开期间切换范围保留勾选。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job?.id]);

  if (!job) return null;

  const validRange = Boolean(start && end && end >= start);
  const available = validRange
    ? eachDay(start, end).filter((date) => isCandidate(date))
    : [];
  const availableSet = new Set(available);
  const sorted = [...selected].sort();
  const outOfRange = sorted.filter((date) => !availableSet.has(date));
  const allSelected =
    available.length > 0 && available.every((date) => selected.has(date));

  const baseHours = Number(hoursInput);
  const baseBonus = Number(bonusInput);
  const baseDeduction = Number(deductionInput);
  const validBaseHours =
    Number.isFinite(baseHours) && baseHours > 0 && baseHours <= 24;
  const validBaseBonus = Number.isFinite(baseBonus) && baseBonus >= 0;
  const validBaseDeduction =
    Number.isFinite(baseDeduction) && baseDeduction >= 0;

  const resolved = (date: string): PlannedEntryOptions => {
    const override = overrides[date] ?? EMPTY_OVERRIDE;
    return {
      hours: override.hours.trim() ? Number(override.hours) : baseHours,
      bonus: override.bonus.trim() ? Number(override.bonus) : baseBonus,
      deduction: override.deduction.trim()
        ? Number(override.deduction)
        : baseDeduction,
      note: note.trim() || undefined,
    };
  };

  const validItem = (date: string) => {
    const item = resolved(date);
    return (
      Number.isFinite(item.hours) &&
      (item.hours ?? 0) > 0 &&
      (item.hours ?? 0) <= 24 &&
      Number.isFinite(item.bonus) &&
      (item.bonus ?? 0) >= 0 &&
      Number.isFinite(item.deduction) &&
      (item.deduction ?? 0) >= 0
    );
  };

  const items: PlanItem[] = sorted.map((date) => ({
    date,
    options: resolved(date),
  }));
  const totalHours = items.reduce(
    (sum, item) => sum + (item.options.hours ?? 0),
    0,
  );
  const validAll =
    validBaseHours &&
    validBaseBonus &&
    validBaseDeduction &&
    sorted.every((date) => validItem(date));

  const pruneSelected = () => {
    setSelected((prev) => new Set([...prev].filter((date) => isCandidate(date))));
  };

  const applyPreset = (days: number) => {
    setStart(today);
    setEnd(addDays(today, days - 1));
    pruneSelected();
  };

  const changeStart = (value: string) => {
    setStart(value);
    if (value && end && value > end) setEnd(value);
    pruneSelected();
  };

  const changeEnd = (value: string) => {
    setEnd(value);
    if (value && start && value < start) setStart(value);
    pruneSelected();
  };

  const toggle = (date: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const updateOverride = (
    date: string,
    key: keyof DayOverride,
    value: string,
  ) => {
    setOverrides((prev) => {
      const current = { ...(prev[date] ?? EMPTY_OVERRIDE), [key]: value };
      const copy = { ...prev };
      if (!current.hours && !current.bonus && !current.deduction) {
        delete copy[date];
      } else {
        copy[date] = current;
      }
      return copy;
    });
  };

  const applyTemplate = (id: string) => {
    const template = templates.find((item) => item.id === id);
    setTemplateId(id);
    if (!template) return;
    setHoursInput(String(template.hours));
    setBonusInput(String(template.bonus));
    setDeductionInput(String(template.deduction));
    setNote(template.note);
  };

  const saveTemplate = () => {
    const name =
      note.trim() ||
      `${formatHours(baseHours)}h/天${baseBonus ? ` · 奖${baseBonus}` : ''}${
        baseDeduction ? ` · 扣${baseDeduction}` : ''
      }`;
    const result = upsertBatchTemplate(templates, {
      name,
      hours: baseHours,
      bonus: baseBonus,
      deduction: baseDeduction,
      note: note.trim(),
    });
    setTemplates(result.templates);
    setTemplateId(result.saved.id);
  };

  const removeTemplate = () => {
    if (!templateId) return;
    setTemplates(deleteBatchTemplate(templates, templateId));
    setTemplateId('');
  };

  return (
    <Sheet
      open={open}
      title="批量补记"
      subtitle={
        validRange
          ? `${job.name} · ${formatDateShort(start)} – ${formatDateShort(end)}`
          : `${job.name} · 请选择有效日期范围`
      }
      onClose={onClose}
      className="batch-plan-sheet"
    >
      <div className="sheet-body">
        <div className="batch-range-tabs" role="group" aria-label="快捷范围">
          {PRESETS.map((days) => (
            <button
              type="button"
              key={days}
              className={
                start === today && end === addDays(today, days - 1) ? 'is-active' : ''
              }
              aria-pressed={start === today && end === addDays(today, days - 1)}
              onClick={() => applyPreset(days)}
            >
              未来 {days} 天
            </button>
          ))}
        </div>
        <div className="batch-custom-range">
          <label>
            <span>从</span>
            <input
              type="date"
              value={start}
              min={today}
              max={addDays(today, 365)}
              onChange={(event) => changeStart(event.target.value)}
              aria-label="补记开始日期"
            />
          </label>
          <span className="batch-range-sep">—</span>
          <label>
            <span>到</span>
            <input
              type="date"
              value={end}
              min={start || today}
              max={addDays(today, 365)}
              onChange={(event) => changeEnd(event.target.value)}
              aria-label="补记结束日期"
            />
          </label>
        </div>

        <div className="batch-plan-summary">
          <div>
            <strong>{sorted.length}</strong>
            <span> 天</span>
          </div>
          <p>
            {validAll ? `共 ${formatHours(totalHours)}h` : '有无效工时，请检查'}
          </p>
        </div>
        <div className="batch-select-bar">
          <span>
            已选 {sorted.length} 天
            {outOfRange.length > 0 ? `（范围外 ${outOfRange.length} 天）` : ''}
          </span>
          <div>
            <button
              type="button"
              className="text-link"
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  for (const date of available) next.add(date);
                  return next;
                })
              }
              disabled={allSelected}
            >
              全选
            </button>
            <button
              type="button"
              className="text-link"
              onClick={() => setSelected(new Set())}
              disabled={selected.size === 0}
            >
              清空
            </button>
          </div>
        </div>
        {outOfRange.length > 0 ? (
          <p className="batch-out-range">
            范围外已选 {outOfRange.length} 天：
            {outOfRange.slice(0, 3).map((date) => formatDateShort(date)).join('、')}
            {outOfRange.length > 3 ? ' 等' : ''}
            ，仍会一并补记；切换范围不会丢掉手动勾选。
          </p>
        ) : null}

        <div className="batch-pay-fields">
          <label>
            <span>工时 / 天</span>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={hoursInput}
              onChange={(event) => {
                setHoursInput(event.target.value);
                setTemplateId('');
              }}
              aria-label="批量工时"
            />
          </label>
          <label>
            <span>奖金 / 天</span>
            <input
              type="number"
              min={0}
              step={1}
              value={bonusInput}
              onChange={(event) => {
                setBonusInput(event.target.value);
                setTemplateId('');
              }}
              aria-label="批量奖金"
            />
          </label>
          <label>
            <span>扣款 / 天</span>
            <input
              type="number"
              min={0}
              step={1}
              value={deductionInput}
              onChange={(event) => {
                setDeductionInput(event.target.value);
                setTemplateId('');
              }}
              aria-label="批量扣款"
            />
          </label>
        </div>
        {!validAll ? (
          <p className="form-error">工时需在 0–24 之间，奖金 / 扣款不能为负</p>
        ) : null}

        <div className="batch-template-bar">
          <select
            value={templateId}
            onChange={(event) => applyTemplate(event.target.value)}
            aria-label="常用模板"
          >
            <option value="">常用模板</option>
            {templates.map((template) => (
              <option value={template.id} key={template.id}>
                {template.name} · {formatHours(template.hours)}h
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-link"
            onClick={saveTemplate}
            disabled={!validBaseHours || !validBaseBonus || !validBaseDeduction}
          >
            保存模板
          </button>
          <button
            type="button"
            className="text-link"
            onClick={removeTemplate}
            disabled={!templateId}
          >
            删除
          </button>
        </div>

        <label className="batch-note-field">
          <span>统一备注</span>
          <input
            type="text"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setTemplateId('');
            }}
            placeholder="默认：排班补记"
            maxLength={40}
            aria-label="统一备注"
          />
        </label>

        {available.length === 0 ? (
          <div className="batch-plan-empty">
            <ClipboardList size={22} />
            <p>当前日期范围没有可补记的计划上班日</p>
          </div>
        ) : (
          <div className="batch-plan-list">
            {available.map((date) => {
              const checked = selected.has(date);
              const item = resolved(date);
              return (
                <label
                  className={`batch-plan-row ${checked ? 'is-checked' : ''}`}
                  key={date}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(date)}
                  />
                  <span className="batch-plan-check">
                    {checked ? <Check size={12} /> : null}
                  </span>
                  <span className="batch-plan-date">
                    {formatDateShort(date)}
                    <em>周{weekdayShort(date)}</em>
                  </span>
                  <strong>
                    {validItem(date) ? `${formatHours(item.hours ?? 0)}h` : '—'}
                  </strong>
                </label>
              );
            })}
          </div>
        )}

        <details className="batch-overrides">
          <summary>逐天微调（已选 {sorted.length} 天）</summary>
          {sorted.length === 0 ? (
            <p className="field-hint">先勾选日期，再逐天修改工时、奖金或扣款。</p>
          ) : (
            <div className="batch-override-list">
              {sorted.map((date) => {
                const override = overrides[date] ?? EMPTY_OVERRIDE;
                return (
                  <div className="batch-override-row" key={date}>
                    <span>{formatDateShort(date)}</span>
                    <label>
                      <em>工</em>
                      <input
                        type="number"
                        min={0.5}
                        max={24}
                        step={0.5}
                        value={override.hours}
                        placeholder={String(baseHours)}
                        onChange={(event) =>
                          updateOverride(date, 'hours', event.target.value)
                        }
                        aria-label={`${date} 工时`}
                      />
                    </label>
                    <label>
                      <em>奖</em>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={override.bonus}
                        placeholder={String(baseBonus)}
                        onChange={(event) =>
                          updateOverride(date, 'bonus', event.target.value)
                        }
                        aria-label={`${date} 奖金`}
                      />
                    </label>
                    <label>
                      <em>扣</em>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={override.deduction}
                        placeholder={String(baseDeduction)}
                        onChange={(event) =>
                          updateOverride(date, 'deduction', event.target.value)
                        }
                        aria-label={`${date} 扣款`}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </details>

        <p className="field-hint">
          默认按班次生成；修改工时后，时薪岗位改用统一工时、不再拆分上下班时间。备注留空为「排班补记」。
        </p>
      </div>
      <div className="sheet-footer">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onGenerate(items)}
          disabled={sorted.length === 0 || !validAll}
        >
          补记 {sorted.length} 天
        </button>
      </div>
    </Sheet>
  );
}
