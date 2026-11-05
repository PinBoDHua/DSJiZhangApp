import { useEffect, useState } from 'react';
import { Check, ClipboardList } from 'lucide-react';
import type { Entry, Job, RestDay, Settlement } from '../types';
import { addDays, eachDay, formatDateShort, todayISO, weekdayShort } from '../lib/date';
import { formatHours } from '../lib/money';
import { planStatusForJob } from '../lib/plan';
import { plannedEntryHours } from '../lib/planEntries';
import { Sheet } from './Sheet';

interface BatchPlanSheetProps {
  open: boolean;
  job: Job | undefined;
  entries: Entry[];
  restDays: RestDay[];
  settlements: Settlement[];
  onClose: () => void;
  onGenerate: (dates: string[], note?: string) => void;
}

export function BatchPlanSheet({
  open,
  job,
  entries,
  restDays,
  settlements,
  onClose,
  onGenerate,
}: BatchPlanSheetProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rangeDays, setRangeDays] = useState(30);
  const [note, setNote] = useState('');
  const today = todayISO();
  const hours = job ? plannedEntryHours(job) : 0;
  const available = job
    ? eachDay(today, addDays(today, rangeDays - 1)).filter((date) => {
        if (planStatusForJob(job, date, entries, restDays) !== 'work') return false;
        return !settlements.some(
          (settlement) =>
            settlement.jobId === job.id &&
            date >= settlement.periodStart &&
            date <= settlement.periodEnd,
        );
      })
    : [];
  const datesKey = available.join(',');
  const allSelected = available.length > 0 && selected.size === available.length;

  useEffect(() => {
    if (!open) return;
    setRangeDays(30);
    setNote('');
  }, [open, job?.id]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(available));
    // 只在打开或范围变化时重置，避免每次输入都覆盖选择。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job?.id, datesKey]);

  if (!job) return null;

  const toggle = (date: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const sorted = [...selected].sort();

  return (
    <Sheet
      open={open}
      title="批量补记"
      subtitle={`${job.name} · 未来 ${rangeDays} 天的计划上班日`}
      onClose={onClose}
      className="batch-plan-sheet"
    >
      <div className="sheet-body">
        <div className="batch-range-tabs" role="group" aria-label="补记范围">
          {[7, 14, 30].map((days) => (
            <button
              type="button"
              key={days}
              className={rangeDays === days ? 'is-active' : ''}
              aria-pressed={rangeDays === days}
              onClick={() => setRangeDays(days)}
            >
              未来 {days} 天
            </button>
          ))}
        </div>
        <div className="batch-plan-summary">
          <div>
            <strong>{sorted.length}</strong>
            <span> 天</span>
          </div>
          <p>
            每天默认 {formatHours(hours)}h · 共 {formatHours(sorted.length * hours)}h
          </p>
        </div>
        <div className="batch-select-bar">
          <span>已选 {sorted.length} 天</span>
          <div>
            <button
              type="button"
              className="text-link"
              onClick={() => setSelected(new Set(available))}
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
        <label className="batch-note-field">
          <span>统一备注</span>
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="默认：排班补记"
            maxLength={40}
            aria-label="统一备注"
          />
        </label>
        {available.length === 0 ? (
          <div className="batch-plan-empty">
            <ClipboardList size={22} />
            <p>未来 {rangeDays} 天没有可补记的计划上班日</p>
          </div>
        ) : (
          <div className="batch-plan-list">
            {available.map((date) => {
              const checked = selected.has(date);
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
                  <strong>{formatHours(hours)}h</strong>
                </label>
              );
            })}
          </div>
        )}
        <p className="field-hint">
          只生成预填默认班次的工记；备注优先使用统一备注，留空则为「排班补记」。生成后仍可逐笔修改。
        </p>
      </div>
      <div className="sheet-footer">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => onGenerate(sorted, note.trim() || undefined)}
          disabled={sorted.length === 0}
        >
          补记 {sorted.length} 天
        </button>
      </div>
    </Sheet>
  );
}
