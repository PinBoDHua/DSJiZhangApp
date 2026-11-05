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
import { Sheet } from './Sheet';

interface BatchPlanSheetProps {
  open: boolean;
  job: Job | undefined;
  entries: Entry[];
  restDays: RestDay[];
  settlements: Settlement[];
  onClose: () => void;
  onGenerate: (dates: string[], options: PlannedEntryOptions) => void;
}

const PRESETS = [7, 14, 30];

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
  const outOfRange = [...selected].filter((date) => !availableSet.has(date));
  const allSelected =
    available.length > 0 && available.every((date) => selected.has(date));
  const hours = Number(hoursInput);
  const bonus = Number(bonusInput);
  const validHours = Number.isFinite(hours) && hours > 0 && hours <= 24;
  const validBonus = Number.isFinite(bonus) && bonus >= 0;

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

  const sorted = [...selected].sort();

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
            {validHours ? `每天 ${formatHours(hours)}h` : '工时未填'} · 共{' '}
            {formatHours(validHours ? sorted.length * hours : 0)}h
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
              onChange={(event) => setHoursInput(event.target.value)}
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
              onChange={(event) => setBonusInput(event.target.value)}
              aria-label="批量奖金"
            />
          </label>
        </div>
        {!validHours ? (
          <p className="form-error">工时需要大于 0 且不超过 24 小时</p>
        ) : null}
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
            <p>当前日期范围没有可补记的计划上班日</p>
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
                  <strong>{validHours ? `${formatHours(hours)}h` : '—'}</strong>
                </label>
              );
            })}
          </div>
        )}
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
          onClick={() =>
            onGenerate(sorted, {
              hours,
              bonus,
              note: note.trim() || undefined,
            })
          }
          disabled={sorted.length === 0 || !validHours || !validBonus}
        >
          补记 {sorted.length} 天
        </button>
      </div>
    </Sheet>
  );
}
