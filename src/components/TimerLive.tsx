import { useEffect, useState } from 'react';
import { Clock3, X } from 'lucide-react';
import type { Job, WorkTimer } from '../types';
import { formatElapsed, elapsedSeconds, isTimerOverlong } from '../lib/timer';
import { JobDot } from './JobDot';

interface TimerLiveProps {
  timer: WorkTimer;
  job?: Job;
  onFinish: (timer: WorkTimer, endedAt: Date) => void;
  onCancel: () => void;
}

export function TimerLive({ timer, job, onFinish, onCancel }: TimerLiveProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const seconds = elapsedSeconds(timer.startedAt, now);
  const overlong = isTimerOverlong(timer.startedAt);
  const started = new Date(timer.startedAt);
  const startTime = `${String(started.getHours()).padStart(2, '0')}:${String(
    started.getMinutes(),
  ).padStart(2, '0')}`;

  return (
    <section className={`timer-live ${overlong ? 'timer-live--warn' : ''}`} aria-label="计时进行中">
      <span className="timer-live-icon">
        <Clock3 size={19} />
      </span>
      <div className="timer-live-main">
        <div className="timer-live-head">
          <JobDot color={job?.color ?? 'pine'} size={7} />
          <span>{job?.name ?? '未知工作'}</span>
          <em>
            <i />
            计时中
          </em>
        </div>
        <strong className="timer-clock">{formatElapsed(seconds)}</strong>
        <p>
          {overlong ? '超过 24 小时了，记得结束并核对工时' : `从 ${startTime} 开始 · 结束后带出工记`}
        </p>
      </div>
      <div className="timer-live-actions">
        <button
          type="button"
          className="btn btn--primary btn--sm timer-stop"
          onClick={() => onFinish(timer, new Date())}
        >
          结束
        </button>
        <button
          type="button"
          className="timer-cancel"
          onClick={onCancel}
          aria-label="放弃计时"
          title="放弃计时"
        >
          <X size={16} />
        </button>
      </div>
    </section>
  );
}
