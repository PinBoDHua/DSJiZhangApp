import { useEffect, useState, type CSSProperties } from 'react';
import {
  ArrowUpRight,
  BellRing,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  Coffee,
  Eye,
  EyeOff,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sun,
} from 'lucide-react';
import { useStore } from '../store';
import { EntryRow } from '../components/EntryRow';
import { JobDot } from '../components/JobDot';
import { Logo, Wordmark } from '../components/Logo';
import { Money } from '../components/Money';
import { BarChart } from '../components/BarChart';
import { EmptyState } from '../components/EmptyState';
import { TimerLive } from '../components/TimerLive';
import { TimerSheet } from '../components/TimerSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { RestSheet } from '../components/RestSheet';
import { RestPlanSheet } from '../components/RestPlanSheet';
import { BatchPlanSheet } from '../components/BatchPlanSheet';
import type { WorkTimer } from '../types';
import type { TimerTimes } from '../lib/timer';
import { buildTimerTimes } from '../lib/timer';
import {
  addDays,
  daysInMonth,
  formatDateWithWeekday,
  formatMonthTitle,
  pad2,
  periodContains,
  periodOf,
  todayISO,
  weekdayShort,
} from '../lib/date';
import { formatHours } from '../lib/money';
import { formatRestDays, totalRestDays } from '../lib/rest';
import { cycleLabel, jobColor, rateLabel } from '../lib/meta';
import { computeOutstanding, dailySeries, getSettlementOverview, sumEntries, sumEntriesCapped } from '../lib/settlement';
import { backupDueText, backupIsDue } from '../lib/backupStatus';
import { daysUntilPayday } from '../lib/payment';
import { planStatusForJob, shortWeekday, formatWorkWeekdays } from '../lib/plan';
import { makePlannedEntry, type PlannedEntryOptions } from '../lib/planEntries';

const PLAN_JOB_KEY = 'xinshi.planJobId';

function readPlanJobId(): string | undefined {
  try {
    return localStorage.getItem(PLAN_JOB_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

interface HomeProps {
  onAddEntry: (jobId?: string) => void;
  onAddEntryAt: (jobId: string | undefined, date: string) => void;
  onOpenEntry: (entryId: string) => void;
  onOpenJobs: () => void;
  onGoRecords: () => void;
  onGoSettlements: () => void;
  onOpenProfile: () => void;
  onOpenDataSafety: () => void;
  onFinishTimer: (jobId: string, times: TimerTimes) => void;
}

export function Home({
  onAddEntry,
  onAddEntryAt,
  onOpenEntry,
  onOpenJobs,
  onGoRecords,
  onGoSettlements,
  onOpenProfile,
  onOpenDataSafety,
  onFinishTimer,
}: HomeProps) {
  const { state, updateProfile, startTimer, clearTimer, toast, addEntry } = useStore();
  const [timerSheetOpen, setTimerSheetOpen] = useState(false);
  const [cancelTimerOpen, setCancelTimerOpen] = useState(false);
  const [restSheetOpen, setRestSheetOpen] = useState(false);
  const [restPlanOpen, setRestPlanOpen] = useState(false);
  const [restPlanJobId, setRestPlanJobId] = useState<string | undefined>();
  const [batchPlanOpen, setBatchPlanOpen] = useState(false);
  const [planJobId, setPlanJobId] = useState<string | undefined>(readPlanJobId);
  const today = todayISO();
  const month = periodOf('monthly', today, state.settings.weekStartsOn);
  const monthEntries = state.entries.filter((entry) => periodContains(month, entry.date));
  const summary = sumEntriesCapped(monthEntries);
  const outstanding = computeOutstanding(state);
  const overview = getSettlementOverview(state);
  const activeJobs = state.jobs.filter((job) => !job.archived);
  const timerJobs = activeJobs.filter((job) => job.rule.payType !== 'piece');
  const todayEntries = state.entries
    .filter((entry) => entry.date === today)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const todayRestDays = state.restDays.filter((rest) => rest.date === today);
  const monthRestDays = state.restDays.filter((rest) =>
    periodContains(month, rest.date),
  );
  const lastUsedJobId = [...state.entries].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0]?.jobId;
  const repeatEntry = [...state.entries]
    .filter((entry) => entry.startTime && entry.endTime && entry.date !== today)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0];
  const monthDay = Number(today.slice(8, 10));
  const monthLength = daysInMonth(today);
  const monthProgress = Math.min(100, Math.round((monthDay / monthLength) * 100));
  const fixedMonthlyJob = activeJobs.find(
    (job) => job.rule.payType === 'monthly' && job.rule.monthlyMode === 'fixed',
  );
  const fixedMonthlyJobs = activeJobs.filter(
    (job) => job.rule.payType === 'monthly' && job.rule.monthlyMode === 'fixed',
  );
  const monthRestTotal = totalRestDays(monthRestDays);
  const fixedRestDays =
    fixedMonthlyJob !== undefined
      ? totalRestDays(monthRestDays.filter((rest) => rest.jobId === fixedMonthlyJob.id))
      : monthRestTotal;
  const restQuota =
    fixedMonthlyJobs.length === 1 &&
    (fixedMonthlyJobs[0].rule.restPolicy ?? 'quota') !== 'flexible'
      ? fixedMonthlyJobs[0].rule.restDaysPerMonth
      : 0;
  const hasFixedMonthly = state.entries.some(
    (entry) => entry.rule.payType === 'monthly' && entry.rule.monthlyMode === 'fixed',
  );
  const restJobId =
    todayRestDays[0]?.jobId ??
    fixedMonthlyJob?.id ??
    (lastUsedJobId && activeJobs.some((job) => job.id === lastUsedJobId)
      ? lastUsedJobId
      : activeJobs[0]?.id);
  const backupDue = backupIsDue(state);
  const paydayReminder = activeJobs
    .filter((job) => job.cycle === 'monthly' && job.payday)
    .map((job) => ({ job, days: daysUntilPayday(job.payday as number, today) }))
    .filter((item) => item.days <= 3)
    .sort((a, b) => a.days - b.days)[0];
  const planJobs = activeJobs.filter(
    (job) => job.workWeekdays && job.workWeekdays.length > 0,
  );
  const planJob = planJobs.find((job) => job.id === planJobId) ?? planJobs[0];
  const nextPlanDays = planJob
    ? Array.from({ length: 7 }, (_, index) => {
        const date = addDays(today, index);
        const status = planStatusForJob(
          planJob,
          date,
          state.entries,
          state.restDays,
        );
        return {
          date,
          status,
          label:
            status === 'worked'
              ? '已记'
              : status === 'work'
                ? '上班'
                : status === 'rest' || status === 'off'
                  ? '休息'
                  : '—',
        };
      })
    : [];
  const todayPlan = planJob
    ? planStatusForJob(planJob, today, state.entries, state.restDays)
    : 'none';

  useEffect(() => {
    if (!planJob) return;
    try {
      localStorage.setItem(PLAN_JOB_KEY, planJob.id);
    } catch {
      // 本地偏好存不下不影响排班展示。
    }
  }, [planJob?.id]);

  const generatePlanEntries = (
    items: Array<{ date: string; options: PlannedEntryOptions }>,
  ) => {
    if (!planJob) return;
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      const input = makePlannedEntry(planJob, item.date, item.options);
      if (!input) {
        skipped += 1;
        continue;
      }
      const dayHours = state.entries
        .filter((entry) => entry.date === item.date)
        .reduce((sum, entry) => sum + entry.hours, 0);
      if (dayHours + input.hours > 24) {
        skipped += 1;
        continue;
      }
      if (addEntry(input)) added += 1;
      else skipped += 1;
    }
    setBatchPlanOpen(false);
    if (added > 0) {
      toast(`已补记 ${added} 天${skipped > 0 ? `，跳过 ${skipped} 天` : ''}`);
    } else {
      toast('没有可补记的日期，可能已经记过或周期已结算', 'error');
    }
  };
  const todayTotals = sumEntries(todayEntries);
  const todayHasFixedMonthly = todayEntries.some(
    (entry) => entry.rule.payType === 'monthly' && entry.rule.monthlyMode === 'fixed',
  );
  const recent = [...state.entries]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  const start = addDays(today, -6);
  const series = dailySeries(state.entries, start, today).map((point) => ({
    date: point.date,
    label: weekdayShort(point.date),
    value: point.earnings,
    highlight: point.date === today,
  }));
  const weekTotal = series.reduce((sum, point) => sum + point.value, 0);
  const pendingByJob = new Map(overview.jobs.map((item) => [item.job.id, item]));
  const name = state.profile.name.trim() || '工友';
  const avatar = name.slice(0, 1);
  const todayNames = Array.from(
    new Set(
      todayEntries.map(
        (entry) => state.jobs.find((job) => job.id === entry.jobId)?.name ?? '未知工作',
      ),
    ),
  );
  const activeTimer = state.activeTimer;
  const timerJob = activeTimer
    ? state.jobs.find((job) => job.id === activeTimer.jobId)
    : undefined;

  const beginTimer = (jobId: string) => {
    if (startTimer(jobId)) {
      setTimerSheetOpen(false);
      toast('开始计时，结束时会带出工记');
    } else {
      toast('已有进行中的计时，先结束或放弃它', 'error');
    }
  };

  const handleTimerStart = () => {
    if (activeTimer) return;
    if (timerJobs.length === 0) {
      toast('计件工作不需要计时，直接记数量就好', 'info');
      return;
    }
    if (timerJobs.length === 1) {
      beginTimer(timerJobs[0].id);
      return;
    }
    setTimerSheetOpen(true);
  };

  const finishTimer = (timer: WorkTimer, endedAt: Date) => {
    const times = buildTimerTimes(timer.startedAt, endedAt);
    let message = '计时结束，确认一下工时';
    if (times.startTime === times.endTime) {
      const [hours, minutes] = times.startTime.split(':').map(Number);
      const total = (hours * 60 + minutes + 1) % 1440;
      times.endTime = `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
      message = '计时不足 1 分钟，已先按 1 分钟带出';
    }
    if (endedAt.getTime() - Date.parse(timer.startedAt) > 24 * 3600 * 1000) {
      message = '计时超过 24 小时，请在工记里核对工时';
    }
    clearTimer();
    onFinishTimer(timer.jobId, times);
    toast(message);
  };

  const cancelTimer = () => {
    clearTimer();
    setCancelTimerOpen(false);
    toast('已放弃这次计时', 'info');
  };

  return (
    <div className="page home-page">
      <header className="home-top">
        <div className="brand-lockup">
          <Logo size={34} />
          <Wordmark />
        </div>
        <button type="button" className="avatar-button" onClick={onOpenProfile} aria-label="打开我的">
          {avatar}
        </button>
      </header>

      <div className="welcome">
        <p className="eyebrow">{formatDateWithWeekday(today)}</p>
        <h1>{name}的记工账本</h1>
      </div>

      {backupDue ? (
        <button type="button" className="backup-nudge" onClick={onOpenDataSafety}>
          <span className="backup-nudge-icon">
            <ShieldAlert size={17} />
          </span>
          <span className="backup-nudge-copy">
            <strong>该给账本留个底了</strong>
            <em>{backupDueText(state)}，换手机或清缓存会丢账。</em>
          </span>
          <ChevronRight size={16} />
        </button>
      ) : null}

      {paydayReminder ? (
        <button type="button" className="payday-nudge" onClick={onGoSettlements}>
          <span className="payday-nudge-icon">
            <BellRing size={17} />
          </span>
          <span className="payday-nudge-copy">
            <strong>
              {paydayReminder.days === 0
                ? '今天发薪'
                : paydayReminder.days === 1
                  ? '明天发薪'
                  : `还有 ${paydayReminder.days} 天发薪`}{' '}
              · {paydayReminder.job.name}
            </strong>
            <em>去核对结算，登记收款状态。</em>
          </span>
          <ChevronRight size={16} />
        </button>
      ) : null}

      <section className="hero-card" aria-label="本月收入概览">
        <div className="hero-deco hero-deco--one" aria-hidden="true" />
        <div className="hero-deco hero-deco--two" aria-hidden="true" />
        <div className="hero-head">
          <span>本月预计收入</span>
          <div className="hero-head-actions">
            <button type="button" className="hero-detail-link" onClick={onGoRecords}>
              明细
              <ChevronRight size={15} />
            </button>
            <button
              type="button"
              className="hero-eye"
              onClick={() => updateProfile({ hideAmounts: !state.profile.hideAmounts })}
              aria-label={state.profile.hideAmounts ? '显示金额' : '隐藏金额'}
            >
              {state.profile.hideAmounts ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>
        <div className="hero-money-row">
          <Money value={summary.total} className="hero-money" />
        </div>
        <div className="hero-caption">
          <span>
            {formatMonthTitle(today)} · 已记 {summary.days} 天
            {restQuota > 0
              ? ` · 休 ${formatRestDays(fixedRestDays)}/${restQuota} 天`
              : monthRestTotal > 0
                ? ` · 休 ${formatRestDays(monthRestTotal)} 天`
                : ''}
          </span>
          {outstanding.net !== 0 ? (
            <button type="button" className="hero-pending" onClick={onGoSettlements}>
              {outstanding.net < 0 ? '借支待抵' : '待结'}{' '}
              <Money value={Math.abs(outstanding.net)} />
              <ArrowUpRight size={13} />
            </button>
          ) : (
            <span className="hero-clear">
              <Check size={11} />
              工钱已结清
            </span>
          )}
        </div>
        <div className="hero-progress" aria-hidden="true">
          <span style={{ width: `${monthProgress}%` }} />
        </div>
        <div className="hero-stats">
          <div>
            <span>本月工时</span>
            <strong>
              {formatHours(summary.hours)}
              <em>h</em>
            </strong>
          </div>
          <div>
            <span>出勤</span>
            <strong>
              {summary.days}
              <em>天</em>
            </strong>
          </div>
          <div>
            <span>加班</span>
            <strong>
              {formatHours(summary.otHours)}
              <em>h</em>
            </strong>
          </div>
        </div>
      </section>

      {activeTimer ? (
        <TimerLive
          timer={activeTimer}
          job={timerJob}
          onFinish={finishTimer}
          onCancel={() => setCancelTimerOpen(true)}
        />
      ) : (
        <section className={`today-strip ${todayEntries.length > 0 || todayRestDays.length > 0 ? 'is-done' : ''}`}>
          <span className="today-icon">
            {todayEntries.length > 0 ? (
              <Check size={19} strokeWidth={2.6} />
            ) : todayRestDays.length > 0 ? (
              <Coffee size={19} strokeWidth={2.4} />
            ) : (
              <Sun size={20} />
            )}
          </span>
          <div className="today-copy">
            <h3>
              {todayEntries.length > 0
                ? `今天已记 ${todayEntries.length} 笔`
                : todayRestDays.length > 0
                  ? '今天休息'
                  : todayPlan === 'work'
                    ? '今天计划上班'
                    : todayPlan === 'off'
                      ? '今天安排休息'
                      : '今天还没记工'}
            </h3>
            <p>
              {todayEntries.length > 0 ? (
                <>
                  {todayNames.slice(0, 2).join('、')}
                  {todayNames.length > 2 ? ` 等 ${todayNames.length} 份工作` : ''} ·{' '}
                  {formatHours(todayTotals.hours)}h
                  {todayHasFixedMonthly ? (
                    <>
                      {' · '}
                      <span className="no-break">月薪</span>
                    </>
                  ) : (
                    <>
                      {' · '}
                      <Money value={todayTotals.total} />
                    </>
                  )}
                </>
              ) : todayRestDays.length > 0 ? (
                <>
                  {todayRestDays
                    .map((rest) => activeJobs.find((job) => job.id === rest.jobId)?.name)
                    .filter(Boolean)
                    .join('、')}
                  {' · '}
                  本月已休 {formatRestDays(monthRestTotal)} 天
                </>
              ) : activeJobs.length > 0 ? (
                todayPlan === 'work'
                  ? '按周排班今天是上班日，干完花 10 秒记上。'
                  : todayPlan === 'off'
                    ? '按周排班今天不上班，好好休息；临时上工也可以补记。'
                    : '干完活花 10 秒记上，月底不用再翻聊天记录。'
              ) : (
                '先建一份工作，再开始记工。'
              )}
            </p>
            {todayEntries.length === 0 && repeatEntry?.startTime && repeatEntry.endTime ? (
              <button
                type="button"
                className="today-repeat-link"
                onClick={() =>
                  onFinishTimer(repeatEntry.jobId, {
                    date: today,
                    startTime: repeatEntry.startTime as string,
                    endTime: repeatEntry.endTime as string,
                    breakMinutes: repeatEntry.breakMinutes,
                  })
                }
              >
                <RotateCcw size={12} />
                照上次班次
              </button>
            ) : null}
          </div>
          <div className="today-actions">
            {timerJobs.length > 0 && todayRestDays.length === 0 ? (
              <button
                type="button"
                className="today-timer-btn"
                onClick={handleTimerStart}
                title="开始计时"
                aria-label="开始计时"
              >
                <Clock3 size={15} />
                <span>计时</span>
              </button>
            ) : null}
            {activeJobs.length > 0 ? (
              <button
                type="button"
                className="today-rest-btn"
                onClick={() => setRestSheetOpen(true)}
                title="记休息"
                aria-label="记休息"
              >
                <Coffee size={15} />
                <span className="today-rest-text">休</span>
              </button>
            ) : null}
            <button
              type="button"
              className="today-action"
              onClick={() => (activeJobs.length > 0 ? onAddEntry() : onOpenJobs())}
            >
              {todayEntries.length > 0 ? '再记' : activeJobs.length > 0 ? '记上' : '建工作'}
              <Plus size={15} />
            </button>
          </div>
        </section>
      )}

      <section className="section-block recent-section">
        <div className="section-head">
          <div>
            <h2>最近明细</h2>
            <p>每一笔工时和工钱，都有据可查</p>
          </div>
          {recent.length > 0 ? (
            <button type="button" className="text-link" onClick={onGoRecords}>
              全部明细
              <ChevronRight size={15} />
            </button>
          ) : null}
        </div>
        {recent.length > 0 ? (
          <div className="card list-card">
            {recent.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                job={state.jobs.find((job) => job.id === entry.jobId)}
                onClick={() => onOpenEntry(entry.id)}
                showDate
              />
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              icon={ClipboardList}
              title="还没有工记"
              description="记下今天干了多久，App 会帮你算好工钱。"
              actionLabel="记第一笔"
              onAction={() => onAddEntry()}
              compact
            />
          </div>
        )}
      </section>

      {planJob ? (
        <section className="plan-week-card">
          <div className="plan-week-head">
            <div>
              <h2>接下来 7 天</h2>
              <p>{planJob.name} · 按固定周排班</p>
            </div>
            <span>
              {planJob.workWeekdays ? formatWorkWeekdays(planJob.workWeekdays) : ''}
            </span>
          </div>
          {planJobs.length > 1 ? (
            <div className="plan-week-tabs">
              {planJobs.map((job) => (
                <button
                  type="button"
                  key={job.id}
                  className={job.id === planJob.id ? 'is-active' : ''}
                  onClick={() => setPlanJobId(job.id)}
                >
                  {job.name}
                </button>
              ))}
            </div>
          ) : null}
          <div className="plan-week-grid">
            {nextPlanDays.map((day) => {
              const canAdd = day.status === 'work';
              return (
                <button
                  type="button"
                  key={day.date}
                  className={[
                    'plan-week-day',
                    `is-${day.status}`,
                    day.date === today ? 'is-today' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={!canAdd}
                  onClick={() => {
                    if (canAdd) onAddEntryAt(planJob.id, day.date);
                  }}
                  title={canAdd ? '补记这天工记' : undefined}
                  aria-label={`${day.date} ${day.label}${
                    canAdd ? '，点击补记工记' : ''
                  }`}
                >
                  <span>{shortWeekday(day.date)}</span>
                  <strong>{Number(day.date.slice(8))}</strong>
                  <em>{day.label}</em>
                </button>
              );
            })}
          </div>
          <div className="plan-week-foot">
            <p className="plan-week-hint">
              点「上班」日可直接补记，打开的是预填工记，仍然需要确认保存。
            </p>
            {planJob.rule.payType !== 'piece' ? (
              <button
                type="button"
                className="text-link plan-week-batch"
                onClick={() => setBatchPlanOpen(true)}
              >
                批量补记
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="card trend-card">
        <div className="section-head section-head--tight">
          <div>
            <h2>近 7 天</h2>
            <p>{hasFixedMonthly ? '固定月薪按日折算参考' : '每天挣了多少'}</p>
          </div>
          <div className="trend-total">
            <span>{hasFixedMonthly ? '折算合计' : '合计'}</span>
            <Money value={weekTotal} />
          </div>
        </div>
        {weekTotal > 0 ? (
          <>
            <BarChart data={series} height={126} labelEvery={1} />
            {hasFixedMonthly ? (
              <p className="calc-note">固定月薪实际按整月发放，图表仅按日折算展示。</p>
            ) : null}
          </>
        ) : (
          <div className="trend-empty">
            <span>这 7 天还是空的</span>
            <button type="button" className="text-link" onClick={() => onAddEntry()}>
              记下第一笔
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </section>

      <section className="section-block">
        <div className="section-head">
          <div>
            <h2>我的工作</h2>
            <p>{activeJobs.length} 份进行中</p>
          </div>
          <button type="button" className="text-link" onClick={onOpenJobs}>
            管理
            <ChevronRight size={15} />
          </button>
        </div>
        {activeJobs.length > 0 ? (
          <div className="job-scroller">
            {activeJobs.map((job) => {
              const meta = jobColor(job.color);
              const pending = pendingByJob.get(job.id);
              const style = {
                '--job-main': meta.main,
                '--job-soft': meta.soft,
                '--job-ink': meta.ink,
              } as CSSProperties;
              return (
                <article className="job-card" style={style} key={job.id}>
                  <div className="job-card-head">
                    <JobDot color={job.color} size={9} ring />
                    <span>{job.name}</span>
                  </div>
                  <p className="job-card-rate">
                    {rateLabel(job.rule.payType, job.rule.rate, job.rule.unitLabel)} ·{' '}
                    {cycleLabel(job.cycle)}
                  </p>
                  {pending && pending.outstanding !== 0 ? (
                    <div className="job-card-pending">
                      <span>{pending.outstanding < 0 ? '借支待抵' : '待结'}</span>
                      <strong>
                        <Money value={Math.abs(pending.outstanding)} />
                      </strong>
                    </div>
                  ) : (
                    <div className="job-card-clear">
                      <Check size={13} />
                      已结清
                    </div>
                  )}
                  <button
                    type="button"
                    className="job-card-add"
                    onClick={() => onAddEntry(job.id)}
                  >
                    <Plus size={14} />
                    记一笔
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="card">
            <EmptyState
              icon={ClipboardList}
              title="还没有工作"
              description="建一份工作，设置好单价和结算周期。"
              actionLabel="新建工作"
              onAction={onOpenJobs}
              compact
            />
          </div>
        )}
      </section>

      <p className="home-quote">每一小时，都算数。</p>

      <TimerSheet
        open={timerSheetOpen}
        jobs={timerJobs}
        onClose={() => setTimerSheetOpen(false)}
        onStart={beginTimer}
      />

      <RestSheet
        open={restSheetOpen}
        jobs={activeJobs}
        initialJobId={restJobId}
        initialDate={today}
        onPlan={() => {
          setRestPlanJobId(restJobId);
          setRestSheetOpen(false);
          setRestPlanOpen(true);
        }}
        onClose={() => setRestSheetOpen(false)}
      />

      <RestPlanSheet
        open={restPlanOpen}
        jobs={activeJobs}
        initialJobId={restPlanJobId}
        onClose={() => setRestPlanOpen(false)}
      />

      <BatchPlanSheet
        open={batchPlanOpen}
        job={planJob}
        entries={state.entries}
        restDays={state.restDays}
        settlements={state.settlements}
        onClose={() => setBatchPlanOpen(false)}
        onGenerate={generatePlanEntries}
      />

      <ConfirmDialog
        open={cancelTimerOpen}
        title="放弃这次计时？"
        description="这次计时不会生成工记，之后可以手动补记。"
        confirmLabel="放弃"
        danger
        onCancel={() => setCancelTimerOpen(false)}
        onConfirm={cancelTimer}
      />
    </div>
  );
}
