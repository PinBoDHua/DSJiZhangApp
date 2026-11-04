import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Coffee } from 'lucide-react';
import type { Job } from '../types';
import { useStore } from '../store';
import {
  addMonths,
  eachDay,
  formatMonthTitle,
  periodOf,
  startOfMonth,
  todayISO,
} from '../lib/date';
import { JobDot } from './JobDot';
import { Sheet } from './Sheet';

interface RestPlanSheetProps {
  open: boolean;
  jobs: Job[];
  initialJobId?: string;
  onClose: () => void;
}

const WEEKDAYS_MONDAY = ['一', '二', '三', '四', '五', '六', '日'];
const WEEKDAYS_SUNDAY = ['日', '一', '二', '三', '四', '五', '六'];

function weekdayOffset(date: string, weekStartsOn: 0 | 1): number {
  const day = new Date(`${date}T00:00:00`).getDay();
  return weekStartsOn === 1 ? (day + 6) % 7 : day;
}

export function RestPlanSheet({
  open,
  jobs,
  initialJobId,
  onClose,
}: RestPlanSheetProps) {
  const { state, addRestDay, toast } = useStore();
  const [jobId, setJobId] = useState(initialJobId ?? jobs[0]?.id ?? '');
  const [monthAnchor, setMonthAnchor] = useState(startOfMonth(todayISO()));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setJobId(initialJobId ?? jobs[0]?.id ?? '');
    setMonthAnchor(startOfMonth(todayISO()));
    setSelected(new Set());
    // 工作列表变化不应重置用户已经勾选的计划。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialJobId]);

  const job = jobs.find((item) => item.id === jobId);
  const period = useMemo(
    () => periodOf('monthly', monthAnchor, state.settings.weekStartsOn),
    [monthAnchor, state.settings.weekStartsOn],
  );
  const today = todayISO();
  const existingRest = new Set(
    state.restDays
      .filter((rest) => rest.jobId === jobId)
      .map((rest) => rest.date),
  );
  const entryDates = new Set(
    state.entries.filter((entry) => entry.jobId === jobId).map((entry) => entry.date),
  );
  const settledDates = new Set<string>();
  for (const settlement of state.settlements.filter((item) => item.jobId === jobId)) {
    for (const date of eachDay(settlement.periodStart, settlement.periodEnd)) {
      settledDates.add(date);
    }
  }

  const existingCount = state.restDays.filter(
    (rest) =>
      rest.jobId === jobId && rest.date >= period.start && rest.date <= period.end,
  ).length;
  const quota = job?.rule.restDaysPerMonth ?? 0;
  const template = job?.workWeekdays;
  const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const days = eachDay(period.start, period.end);

  const canPick = (date: string) =>
    date >= today && !existingRest.has(date) && !entryDates.has(date) && !settledDates.has(date);

  const conflictCount = days.filter(
    (date) => date >= today && (entryDates.has(date) || settledDates.has(date)),
  ).length;
  const overQuota = quota > 0 && existingCount + selected.size > quota;

  const applyTemplate = () => {
    if (!template || template.length === 0) return;
    const next = new Set(selected);
    for (const date of days) {
      const weekday = new Date(`${date}T00:00:00`).getDay();
      if (!template.includes(weekday) && canPick(date)) next.add(date);
    }
    setSelected(next);
  };

  const toggle = (date: string) => {
    if (!canPick(date)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const offset = weekdayOffset(period.start, state.settings.weekStartsOn);
  const weekdays =
    state.settings.weekStartsOn === 1 ? WEEKDAYS_MONDAY : WEEKDAYS_SUNDAY;

  const save = () => {
    if (!job || selected.size === 0) return;
    let added = 0;
    let failed = 0;
    for (const date of [...selected].sort()) {
      if (addRestDay({ jobId: job.id, date, note: '排休计划' })) added += 1;
      else failed += 1;
    }
    if (added > 0) {
      toast(
        overQuota
          ? `已排 ${added} 天休息，超过本月额度 ${quota} 天`
          : `已排 ${added} 天休息`,
      );
    }
    if (failed > 0) toast(`${failed} 天没有排上，可能已有工记或周期已结算`, 'error');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="排休计划"
      subtitle="提前选好休息日，会进入日历和月休额度"
      onClose={onClose}
    >
      <div className="sheet-body">
        <div className="field">
          <span className="field-label">哪份工作</span>
          <div className="plan-job-picker">
            {jobs.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`job-choice ${item.id === jobId ? 'is-active' : ''}`}
                onClick={() => {
                  setJobId(item.id);
                  setSelected(new Set());
                }}
              >
                <JobDot color={item.color} size={7} />
                {item.name}
              </button>
            ))}
          </div>
        </div>

        <div className="plan-month">
          <button
            type="button"
            className="icon-button"
            onClick={() => setMonthAnchor(startOfMonth(addMonths(period.start, -1)))}
            aria-label="上个月"
          >
            <ChevronLeft size={18} />
          </button>
          <strong>{formatMonthTitle(period.start)}</strong>
          <button
            type="button"
            className="icon-button"
            onClick={() => setMonthAnchor(startOfMonth(addMonths(period.start, 1)))}
            aria-label="下个月"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {template && template.length > 0 && template.length < 7 ? (
          <div className="plan-template-row">
            <span>
              固定上班：{template.map((day) => `周${weekdayLabels[day]}`).join('、')}
            </span>
            <button type="button" className="text-link" onClick={applyTemplate}>
              按周排班选休息日
            </button>
          </div>
        ) : null}

        <div className="plan-weekdays">
          {weekdays.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="plan-grid">
          {Array.from({ length: offset }).map((_, index) => (
            <span key={`blank-${index}`} />
          ))}
          {days.map((date) => {
            const isExisting = existingRest.has(date);
            const isSelected = selected.has(date);
            const disabled = !canPick(date);
            return (
              <button
                type="button"
                key={date}
                className={[
                  'plan-day',
                  isExisting ? 'is-existing' : '',
                  isSelected ? 'is-selected' : '',
                  disabled && !isExisting ? 'is-disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => toggle(date)}
                disabled={disabled}
                aria-label={`${formatMonthTitle(date)}${Number(date.slice(8))}日${
                  isExisting ? '已休' : isSelected ? '已选' : ''
                }`}
              >
                <span>{Number(date.slice(8))}</span>
                {isExisting ? <Coffee size={10} /> : null}
                {isSelected ? <i /> : null}
              </button>
            );
          })}
        </div>

        <div className="plan-summary">
          <span>
            本月已休 {existingCount}
            {quota > 0 ? ` / ${quota}` : ''} 天
          </span>
          <span>已选 {selected.size} 天</span>
        </div>
        {conflictCount > 0 || overQuota ? (
          <div className="plan-warning">
            {conflictCount > 0
              ? `本月有 ${conflictCount} 天已有工记或已结算，不能排休，已自动跳过。`
              : ''}
            {overQuota
              ? `已休 + 已选超过额度 ${quota} 天；仍可保存，是否扣款由超休规则决定。`
              : ''}
          </div>
        ) : null}
        <p className="field-hint">
          只能选今天及以后、没有工记且未结算的日期；保存后会按「排休计划」写入休息记录。
        </p>
      </div>

      <div className="sheet-footer">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          取消
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={save}
          disabled={!job || selected.size === 0}
        >
          保存计划{selected.size > 0 ? `（${selected.size} 天）` : ''}
        </button>
      </div>
    </Sheet>
  );
}
