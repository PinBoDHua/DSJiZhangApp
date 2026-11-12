import { useState, type CSSProperties } from 'react';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  LockKeyhole,
} from 'lucide-react';
import type { Entry, RestDay } from '../types';
import { useStore } from '../store';
import { AttendanceDaySheet } from '../components/AttendanceDaySheet';
import { EmptyState } from '../components/EmptyState';
import { JobDot } from '../components/JobDot';
import { SubPage } from '../components/SubPage';
import {
  addMonths,
  eachDay,
  formatDateShort,
  formatMonthTitle,
  periodOf,
  startOfMonth,
  todayISO,
  weekdayShort,
} from '../lib/date';
import { formatHours } from '../lib/money';
import { buildAttendanceCsv } from '../lib/csv';
import { saveTextFile } from '../lib/native';
import { formatRestDays, restDayAmount, totalRestDays } from '../lib/rest';

interface AttendancePageProps {
  initialJobId?: string;
  onBack: () => void;
  onAddEntry: (jobId: string, date: string) => void;
  onOpenEntry: (entryId: string) => void;
}

interface SelectedCell {
  jobId: string;
  date: string;
}

export function AttendancePage({
  initialJobId,
  onBack,
  onAddEntry,
  onOpenEntry,
}: AttendancePageProps) {
  const { state, toast } = useStore();
  const today = todayISO();
  const [anchor, setAnchor] = useState(startOfMonth(today));
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const period = periodOf('monthly', anchor, state.settings.weekStartsOn);
  const currentMonth = startOfMonth(today);
  const isCurrent = period.start === currentMonth;
  // 批量排休 / 补记可能落在未来月份：有未来记录时允许向后翻页查看。
  const latestDate = state.entries.reduce(
    (max, entry) => (entry.date > max ? entry.date : max),
    state.restDays.reduce((max, rest) => (rest.date > max ? rest.date : max), today),
  );
  const canMoveNext = period.end < latestDate;

  const activeJobs = state.jobs.filter((job) => !job.archived);
  const jobs = initialJobId
    ? activeJobs.filter((job) => job.id === initialJobId)
    : activeJobs;
  const monthEntries = state.entries.filter(
    (entry) => entry.date >= period.start && entry.date <= period.end,
  );
  const monthRests = state.restDays.filter(
    (rest) => rest.date >= period.start && rest.date <= period.end,
  );

  const entryMap = new Map<string, Entry[]>();
  for (const entry of monthEntries) {
    const key = `${entry.jobId}|${entry.date}`;
    const list = entryMap.get(key);
    if (list) list.push(entry);
    else entryMap.set(key, [entry]);
  }
  const restMap = new Map<string, RestDay>();
  for (const rest of monthRests) {
    restMap.set(`${rest.jobId}|${rest.date}`, rest);
  }
  const settledKeys = new Set<string>();
  for (const settlement of state.settlements) {
    for (const date of eachDay(settlement.periodStart, settlement.periodEnd)) {
      settledKeys.add(`${settlement.jobId}|${date}`);
    }
  }

  const days = eachDay(period.start, period.end);
  const workKeys = Array.from(entryMap.keys()).filter((key) => {
    const [jobId] = key.split('|');
    return jobs.some((job) => job.id === jobId);
  });
  const visibleRests = monthRests.filter((rest) =>
    jobs.some((job) => job.id === rest.jobId),
  );
  const summaryHours = monthEntries
    .filter((entry) => jobs.some((job) => job.id === entry.jobId))
    .reduce((sum, entry) => sum + (entry.hours || 0), 0);
  const workDays = new Set(workKeys.map((key) => key.split('|')[1])).size;
  const restTotal = totalRestDays(visibleRests);

  const jobTotals = jobs.map((job) => {
    const jobEntries = monthEntries.filter((entry) => entry.jobId === job.id);
    const jobRests = monthRests.filter((rest) => rest.jobId === job.id);
    return {
      job,
      days: new Set(jobEntries.map((entry) => entry.date)).size,
      rest: totalRestDays(jobRests),
      hours: jobEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0),
    };
  });

  const selectedJob = selected ? jobs.find((job) => job.id === selected.jobId) : undefined;
  const selectedEntries =
    selected && selectedJob
      ? entryMap.get(`${selected.jobId}|${selected.date}`) ?? []
      : [];
  const selectedRest =
    selected && selectedJob
      ? restMap.get(`${selected.jobId}|${selected.date}`)
      : undefined;
  const selectedSettled =
    selected && selectedJob
      ? settledKeys.has(`${selected.jobId}|${selected.date}`)
      : false;

  const exportCsv = async () => {
    if (csvBusy) return;
    setCsvBusy(true);
    const csv = buildAttendanceCsv(
      jobs,
      monthEntries.filter((entry) => jobs.some((job) => job.id === entry.jobId)),
      visibleRests,
      period,
    );
    try {
      const result = await saveTextFile(
        `薪时考勤-${period.start.slice(0, 7)}.csv`,
        csv,
        'text/csv;charset=utf-8',
      );
      toast(
        result === 'native'
          ? '考勤 CSV 已保存到「下载/Xinshi」'
          : '考勤 CSV 已导出',
      );
    } catch {
      toast('考勤 CSV 导出失败，请稍后再试', 'error');
    } finally {
      setCsvBusy(false);
    }
  };

  const moveMonth = (delta: number) => {
    setAnchor(startOfMonth(addMonths(period.start, delta)));
    setSelected(null);
  };

  if (jobs.length === 0) {
    return (
      <SubPage title="月度考勤" subtitle="多岗位 × 日期" onBack={onBack}>
        <div className="card">
          <EmptyState
            icon={CalendarRange}
            title="还没有工作"
            description="先建一份工作，再回来看整月考勤。"
            actionLabel="返回"
            onAction={onBack}
            compact
          />
        </div>
      </SubPage>
    );
  }

  return (
    <>
      <SubPage
        title="月度考勤"
        subtitle={`${jobs.length} 份工作 · 点格子补记工或标休息`}
        onBack={onBack}
        action={
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void exportCsv()}
            disabled={csvBusy}
          >
            <Download size={14} />
            {csvBusy ? '导出中…' : '导出 CSV'}
          </button>
        }
      >
        <div className="month-switch">
          <button
            type="button"
            className="icon-button"
            onClick={() => moveMonth(-1)}
            aria-label="上个月"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="month-switch-label"
            onClick={() => {
              setAnchor(currentMonth);
              setSelected(null);
            }}
            title="回到本月"
          >
            {formatMonthTitle(anchor)}
            {isCurrent ? <span className="micro-badge">本月</span> : null}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => moveMonth(1)}
            disabled={!canMoveNext}
            aria-label="下个月"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <section className="attendance-summary">
          <div className="attendance-summary-main">
            <span>本月出勤</span>
            <strong>{workDays} 天</strong>
          </div>
          <div>
            <span>休息</span>
            <strong>{formatRestDays(restTotal)} 天</strong>
          </div>
          <div>
            <span>工时</span>
            <strong>{formatHours(summaryHours)}h</strong>
          </div>
        </section>

        <div className="attendance-job-totals">
          {jobTotals.map((item) => (
            <span className="attendance-job-total" key={item.job.id}>
              <JobDot color={item.job.color} size={6} />
              <b>{item.job.name}</b>
              <em>
                {item.days} 班 · {formatRestDays(item.rest)} 休 · {formatHours(item.hours)}h
              </em>
            </span>
          ))}
        </div>

        <div className="attendance-table-wrap">
          <div
            className="attendance-table"
            style={{ '--attendance-cols': jobs.length } as CSSProperties}
          >
            <div className="attendance-row attendance-head">
              <div className="attendance-date-cell">日期</div>
              {jobs.map((job) => (
                <div className="attendance-job-head" key={job.id}>
                  <JobDot color={job.color} size={6} />
                  <span>{job.name}</span>
                </div>
              ))}
            </div>
            {days.map((date) => {
              const isToday = date === today;
              const isWeekend = [0, 6].includes(new Date(`${date}T00:00:00`).getDay());
              return (
                <div
                  className={[
                    'attendance-row',
                    isToday ? 'is-today' : '',
                    isWeekend ? 'is-weekend' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={date}
                >
                  <div className="attendance-date-cell">
                    <strong>{Number(date.slice(8))}</strong>
                    <em>{weekdayShort(date)}</em>
                  </div>
                  {jobs.map((job) => {
                    const key = `${job.id}|${date}`;
                    const dayEntries = entryMap.get(key) ?? [];
                    const rest = restMap.get(key);
                    const worked = dayEntries.length > 0;
                    const cellHours = dayEntries.reduce(
                      (sum, entry) => sum + (entry.hours || 0),
                      0,
                    );
                    const locked = settledKeys.has(key);
                    return (
                      <button
                        type="button"
                        key={job.id}
                        className={[
                          'attendance-cell',
                          worked ? 'is-worked' : rest ? 'is-rest' : 'is-empty',
                          locked ? 'is-locked' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setSelected({ jobId: job.id, date })}
                        aria-label={`${formatDateShort(date)} ${job.name} ${
                          worked
                            ? `已记工 ${formatHours(cellHours)} 小时`
                            : rest
                              ? `休息 ${formatRestDays(restDayAmount(rest))} 天`
                              : '未记'
                        }${locked ? '，已结算' : ''}`}
                      >
                        {worked ? (
                          <>
                            <strong>班</strong>
                            <em>{formatHours(cellHours)}h</em>
                          </>
                        ) : rest ? (
                          <>
                            <strong>休</strong>
                            <em>{restDayAmount(rest) === 0.5 ? '½' : '1'}</em>
                          </>
                        ) : (
                          <span>·</span>
                        )}
                        {locked ? <LockKeyhole size={8} className="attendance-lock" /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        <div className="attendance-legend">
          <span>
            <i className="is-worked" />
            已记工
          </span>
          <span>
            <i className="is-rest" />
            休息 / 半天
          </span>
          <span>
            <i className="is-empty" />
            未记
          </span>
          <span>
            <LockKeyhole size={9} />
            已结算
          </span>
        </div>
        <p className="field-hint attendance-hint">
          左右滑动查看全部岗位；点格子可以补记工、标整天 / 半天休息。已结算的格子需要先撤销结算。
        </p>
      </SubPage>

      <AttendanceDaySheet
        open={Boolean(selectedJob && selected)}
        job={selectedJob ?? null}
        date={selected?.date ?? null}
        entries={selectedEntries}
        rest={selectedRest}
        settled={selectedSettled}
        onClose={() => setSelected(null)}
        onAddEntry={onAddEntry}
        onOpenEntry={onOpenEntry}
      />
    </>
  );
}
