import { LockKeyhole } from 'lucide-react';
import type { Entry, Job } from '../types';
import { formatDateShort, formatTimeRange, weekdayShort } from '../lib/date';
import { formatHours } from '../lib/money';
import { payForEntry } from '../lib/pay';
import { JobDot } from './JobDot';
import { Money } from './Money';

export function entryMeta(entry: Entry): string {
  if (entry.rule.payType === 'piece') {
    return `${formatHours(entry.quantity)} ${entry.rule.unitLabel || '件'}${
      entry.hours > 0 ? ` · ${formatHours(entry.hours)}h` : ''
    }`;
  }
  if (entry.startTime && entry.endTime) {
    const overnight = entry.endTime < entry.startTime;
    return `${formatTimeRange(entry.startTime, entry.endTime)}${overnight ? ' 次日' : ''} · ${formatHours(entry.hours)}h`;
  }
  if (entry.rule.payType === 'hourly') return `${formatHours(entry.hours)}h`;
  return `出勤 1 天${entry.hours > 0 ? ` · ${formatHours(entry.hours)}h` : ''}`;
}

interface EntryRowProps {
  entry: Entry;
  job?: Job;
  onClick: () => void;
  showDate?: boolean;
  /** 搜索 / 对账时显示备注，便于看清命中原因 */
  showNote?: boolean;
}

export function EntryRow({ entry, job, onClick, showDate = false, showNote = false }: EntryRowProps) {
  const pay = payForEntry(entry);
  const settled = Boolean(entry.settlementId);
  const date = formatDateShort(entry.date);

  return (
    <button type="button" className="entry-row" onClick={onClick}>
      {showDate ? (
        <span className="entry-date-chip">
          <em>{date}</em>
          <strong>{weekdayShort(entry.date)}</strong>
        </span>
      ) : null}
      <span className="entry-row-main">
        <span className="entry-row-title">
          <JobDot color={job?.color ?? 'pine'} size={8} />
          <span>{job?.name ?? '未知工作'}</span>
          {settled ? <LockKeyhole size={12} className="entry-lock" aria-label="已结算" /> : null}
        </span>
        <span className="entry-row-meta">
          {entryMeta(entry)}
          {entry.otHours > 0 ? (
            <em className="entry-ot">
              加班 {formatHours(pay.otHours)}h
            </em>
          ) : null}
        </span>
        {showNote && entry.note ? <span className="entry-row-note">{entry.note}</span> : null}
      </span>
      <span className="entry-row-amount">
        <Money value={pay.total} />
        {entry.rule.payType === 'monthly' ? (
          <small>{entry.rule.monthlyMode === 'fixed' ? '固定月薪' : '月薪折算'}</small>
        ) : null}
        {entry.rule.payType === 'piece' ? <small>计件</small> : null}
        {settled ? <small className="settled-label">已结算</small> : null}
      </span>
    </button>
  );
}
