import { useEffect, useState } from 'react';
import { CalendarCheck2, Coffee, LockKeyhole, Pencil } from 'lucide-react';
import type { Entry, Job, RestDay } from '../types';
import { useStore } from '../store';
import { formatDateFull, formatDateShort } from '../lib/date';
import { formatHours } from '../lib/money';
import { formatRestDays, restDayAmount } from '../lib/rest';
import { JobDot } from './JobDot';
import { Segmented } from './Segmented';
import { Sheet } from './Sheet';

interface AttendanceDaySheetProps {
  open: boolean;
  job: Job | null;
  date: string | null;
  entries: Entry[];
  rest?: RestDay;
  settled: boolean;
  onClose: () => void;
  onAddEntry: (jobId: string, date: string) => void;
  onOpenEntry: (entryId: string) => void;
}

export function AttendanceDaySheet({
  open,
  job,
  date,
  entries,
  rest,
  settled,
  onClose,
  onAddEntry,
  onOpenEntry,
}: AttendanceDaySheetProps) {
  const { addRestDay, removeRestDay, restoreRestDay, toast } = useStore();
  const [restAmount, setRestAmount] = useState(1);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setRestAmount(rest?.days === 0.5 ? 0.5 : 1);
    setNote('');
  }, [open, date, job?.id, rest?.days]);

  if (!job || !date) return null;

  const hours = entries.reduce((sum, entry) => sum + (entry.hours || 0), 0);
  const hasEntry = entries.length > 0;

  const markRest = () => {
    const created = addRestDay({
      jobId: job.id,
      date,
      days: restAmount,
      note: note.trim() || '考勤补标',
    });
    if (!created) {
      toast('这天已有工记、已结算或已标休息，不能再标休息', 'error');
      return;
    }
    toast(`已记 ${formatDateShort(date)} ${restAmount === 0.5 ? '半天' : '一天'}休息`, 'success', {
      label: '撤销',
      onClick: () => {
        if (removeRestDay(created.id)) toast('已撤销这天的休息');
        else toast('无法撤销，请检查这天是否已经结算', 'error');
      },
    });
    onClose();
  };

  const cancelRest = () => {
    if (!rest) return;
    const removed = rest;
    if (!removeRestDay(removed.id)) {
      toast('这天已经结算，不能取消休息', 'error');
      return;
    }
    toast(`已取消 ${formatDateShort(date)} 的休息`, 'info', {
      label: '撤销',
      onClick: () => {
        if (restoreRestDay(removed)) toast('休息已恢复');
        else toast('无法恢复，这天的周期或工记已经变化', 'error');
      },
    });
    onClose();
  };

  const addEntry = () => {
    onClose();
    onAddEntry(job.id, date);
  };

  return (
    <Sheet
      open={open}
      title={`${formatDateShort(date)} · ${job.name}`}
      subtitle={formatDateFull(date)}
      className="attendance-day-sheet"
      onClose={onClose}
    >
      <div className="sheet-body">
        <div className={`attendance-day-state ${hasEntry ? 'is-worked' : rest ? 'is-rest' : 'is-empty'}`}>
          <span className="attendance-day-icon">
            {hasEntry ? (
              <CalendarCheck2 size={20} />
            ) : rest ? (
              <Coffee size={20} />
            ) : (
              <Pencil size={19} />
            )}
          </span>
          <div>
            <strong>
              {hasEntry
                ? `已记工 ${formatHours(hours)}h`
                : rest
                  ? `休息 ${formatRestDays(restDayAmount(rest))} 天`
                  : '这天还没有记录'}
            </strong>
            <p>
              {hasEntry
                ? `${entries.length} 笔工记${entries[0]?.note ? ` · ${entries[0].note}` : ''}`
                : rest
                  ? `${rest.note || '休息留痕'} · 可取消或改为记工`
                  : '可以补记工，也可以标为休息'}
            </p>
          </div>
        </div>

        {settled ? (
          <p className="form-error attendance-day-locked">
            <LockKeyhole size={14} />
            这天的周期已经结算，先撤销结算再修改。
          </p>
        ) : null}

        {hasEntry ? (
          entries.length === 1 ? (
            <button
              type="button"
              className="btn btn--soft btn--block"
              onClick={() => {
                onClose();
                onOpenEntry(entries[0].id);
              }}
            >
              查看 / 编辑这天的工记
            </button>
          ) : (
            // 一天多笔工记时逐笔列出，否则除第一笔外都不可达。
            entries.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                className="btn btn--soft btn--block"
                onClick={() => {
                  onClose();
                  onOpenEntry(entry.id);
                }}
              >
                第 {index + 1} 笔 · {formatHours(entry.hours)}h
                {entry.startTime && entry.endTime
                  ? ` · ${entry.startTime}–${entry.endTime}`
                  : ''}
              </button>
            ))
          )
        ) : null}

        {!settled && !hasEntry ? (
          <>
            <button type="button" className="btn btn--primary btn--block" onClick={addEntry}>
              补记工
            </button>

            {rest ? (
              <button
                type="button"
                className="btn btn--ghost btn--block attendance-rest-cancel"
                onClick={cancelRest}
              >
                取消这天的休息
              </button>
            ) : (
              <div className="attendance-rest-box">
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
                </div>
                <label className="field">
                  <span className="field-label">休息备注（选填）</span>
                  <input
                    className="text-input"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="例如：调休 / 临时休息"
                    maxLength={30}
                  />
                </label>
                <button type="button" className="btn btn--soft btn--block" onClick={markRest}>
                  标为休息
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
