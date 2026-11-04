import { Play } from 'lucide-react';
import type { Job } from '../types';
import { Sheet } from './Sheet';
import { JobDot } from './JobDot';
import { cycleLabel, rateLabel } from '../lib/meta';

interface TimerSheetProps {
  open: boolean;
  jobs: Job[];
  onClose: () => void;
  onStart: (jobId: string) => void;
}

export function TimerSheet({ open, jobs, onClose, onStart }: TimerSheetProps) {
  return (
    <Sheet open={open} title="开始计时" subtitle="选一份工作，结束时会自动带出上下班时间" onClose={onClose}>
      <div className="sheet-body timer-sheet-body">
        <div className="timer-job-list">
          {jobs.map((job) => (
            <button
              type="button"
              key={job.id}
              className="timer-job-row"
              onClick={() => onStart(job.id)}
            >
              <span className="timer-job-icon">
                <JobDot color={job.color} size={10} ring />
              </span>
              <span className="timer-job-copy">
                <strong>{job.name}</strong>
                <em>
                  {rateLabel(job.rule.payType, job.rule.rate)} · {cycleLabel(job.cycle)}
                </em>
              </span>
              <span className="timer-job-play">
                <Play size={15} fill="currentColor" />
              </span>
            </button>
          ))}
        </div>
        <p className="timer-sheet-hint">
          计时开始后可以关掉页面，回来会接着算。结束时会先带出工时，再让你确认休息和加班。
        </p>
      </div>
    </Sheet>
  );
}
