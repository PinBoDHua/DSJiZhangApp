import { useEffect, useState } from 'react';
import { CalendarDays, Coffee, Trash2 } from 'lucide-react';
import type { Job } from '../types';
import { useStore } from '../store';
import { addDays, formatDateCompact, formatDateFull, periodOf, todayISO } from '../lib/date';
import { formatRestDays, restDayAmount, totalRestDays } from '../lib/rest';
import { JobDot } from './JobDot';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';

interface RestSheetProps {
  open: boolean;
  jobs: Job[];
  initialJobId?: string;
  initialDate?: string;
  onPlan?: () => void;
  onClose: () => void;
}

export function RestSheet({
  open,
  jobs,
  initialJobId,
  initialDate,
  onPlan,
  onClose,
}: RestSheetProps) {
  const { state, addRestDay, removeRestDay, restoreRestDay, toast } = useStore();
  const [jobId, setJobId] = useState(initialJobId ?? jobs[0]?.id ?? '');
  const [date, setDate] = useState(initialDate ?? todayISO());
  const [note, setNote] = useState('');
  const [restAmount, setRestAmount] = useState(1);

  useEffect(() => {
    if (!open) return;
    setJobId(initialJobId ?? jobs[0]?.id ?? '');
    setDate(initialDate ?? todayISO());
    setNote('');
    setRestAmount(1);
    // jobs 由父级按当前工作列表传入，打开时取第一个即可；不要在每次父级渲染时重置。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialJobId, initialDate]);

  const selectedJob = jobs.find((job) => job.id === jobId);
  const existing = state.restDays.find(
    (rest) => rest.jobId === jobId && rest.date === date,
  );
  const entryExists = state.entries.some(
    (entry) => entry.jobId === jobId && entry.date === date,
  );
  const periodSettled = state.settlements.some(
    (settlement) =>
      settlement.jobId === jobId &&
      date >= settlement.periodStart &&
      date <= settlement.periodEnd,
  );
  const blocked = entryExists || periodSettled;
  const month = periodOf('monthly', date, state.settings.weekStartsOn);
  const usedRestDays = totalRestDays(
    state.restDays.filter(
      (rest) =>
        rest.jobId === jobId && rest.date >= month.start && rest.date <= month.end,
    ),
  );
  const restQuota = selectedJob?.rule.restDaysPerMonth ?? 0;
  const isFlexibleRest =
    selectedJob?.rule.payType === 'monthly' &&
    selectedJob.rule.monthlyMode === 'fixed' &&
    (selectedJob.rule.restPolicy ?? 'quota') === 'flexible';

  const save = () => {
    if (!selectedJob) return;
    const created = addRestDay({ jobId, date, note, days: restAmount });
    if (!created) {
      toast('这天已有工记、已结算或已标休息，不能再标休息', 'error');
      return;
    }
    toast(
      `已记 ${formatDateCompact(date)} ${
        restAmount === 0.5 ? '半天' : '一天'
      }休息`,
    );
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    const deleted = existing;
    if (!removeRestDay(existing.id)) {
      toast('这天已经结算，不能取消休息', 'error');
      return;
    }
    toast('已取消休息', 'info', {
      label: '撤销',
      onClick: () => {
        if (restoreRestDay(deleted)) toast('休息已恢复');
        else toast('无法恢复，这天的周期或工记已经变化', 'error');
      },
    });
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="记休息"
      subtitle="随机休息也能留痕；固定月薪岗位不会因此少发"
      className="rest-sheet"
      onClose={onClose}
    >
      <div className="sheet-body">
        <div className="field">
          <span className="field-label">哪份工作</span>
          <div className="job-picker">
            {jobs.map((job) => (
              <button
                type="button"
                key={job.id}
                className={`job-choice ${job.id === jobId ? 'is-active' : ''}`}
                onClick={() => setJobId(job.id)}
              >
                <JobDot color={job.color} size={8} />
                <span>{job.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">休息日期</span>
          <div className="quick-date-row">
            {[0, 1, 2].map((offset) => {
              const iso = addDays(todayISO(), -offset);
              return (
                <button
                  type="button"
                  key={offset}
                  className={`date-chip ${date === iso ? 'is-active' : ''}`}
                  onClick={() => setDate(iso)}
                >
                  <strong>{offset === 0 ? '今天' : offset === 1 ? '昨天' : '前天'}</strong>
                  <span>{formatDateCompact(iso)}</span>
                </button>
              );
            })}
            <label className={`date-native ${[0, 1, 2].some((offset) => addDays(todayISO(), -offset) === date) ? '' : 'is-active'}`}>
              <CalendarDays size={15} />
              <span>换日期</span>
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  if (event.target.value) setDate(event.target.value);
                }}
                aria-label="休息日期"
              />
            </label>
          </div>
          <p className="field-hint">{formatDateFull(date)}</p>
          {isFlexibleRest ? (
            <p className="rest-quota">
              随机休息 · 本月已休 {formatRestDays(usedRestDays)} 天，不设固定额度
            </p>
          ) : selectedJob?.rule.payType === 'monthly' &&
            selectedJob.rule.monthlyMode === 'fixed' &&
            restQuota > 0 ? (
            <p className="rest-quota">
              本月已休 {formatRestDays(usedRestDays)} / {restQuota} 天 · 剩余{' '}
              {formatRestDays(Math.max(0, restQuota - usedRestDays))} 天
            </p>
          ) : null}
        </div>

        {existing ? (
          <div className="rest-existing">
            <span className="rest-existing-icon">
              <Coffee size={18} />
            </span>
            <div>
              <strong>
                这天已标为休息
                {restDayAmount(existing) === 0.5 ? '（半天）' : ''}
              </strong>
              <p>{selectedJob?.name} · {formatDateFull(existing.date)}</p>
            </div>
            <button type="button" className="text-link text-link--danger" onClick={remove}>
              <Trash2 size={14} />
              取消
            </button>
          </div>
        ) : (
          <>
            {blocked ? (
              <p className="form-error">
                {entryExists
                  ? '这天已有工记，换一天或删除工记后再标休息'
                  : '这天已经结算，不能补标休息'}
              </p>
            ) : null}
            {!blocked ? (
              <div className="field">
                <span className="field-label">休息时长</span>
                <Segmented
                  value={String(restAmount)}
                  onChange={(value) => setRestAmount(value === '0.5' ? 0.5 : 1)}
                  options={[
                    { value: '1', label: '整天' },
                    { value: '0.5', label: '半天' },
                  ]}
                  ariaLabel="休息时长"
                />
                <p className="field-hint">半天按 0.5 天计入月休和结算。</p>
              </div>
            ) : null}
            <label className="field">
              <span className="field-label">备注（选填）</span>
              <input
                className="text-input"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：月休 / 调休 / 临时休息"
                maxLength={30}
              />
            </label>
          </>
        )}

        {onPlan ? (
          <button type="button" className="text-link plan-link" onClick={onPlan}>
            <CalendarDays size={14} />
            批量排休 / 提前安排休息日
          </button>
        ) : null}
      </div>

      <div className="sheet-footer">
        <button type="button" className="btn btn--soft" onClick={onClose}>
          取消
        </button>
        {existing ? (
          <button type="button" className="btn btn--danger" onClick={remove}>
            取消休息
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={save}
            disabled={!selectedJob || blocked}
          >
            标为休息
          </button>
        )}
      </div>
    </Sheet>
  );
}
