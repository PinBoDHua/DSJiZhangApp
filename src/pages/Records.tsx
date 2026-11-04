import { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coffee,
  List,
  Plus,
} from 'lucide-react';
import { useStore } from '../store';
import type { Entry } from '../types';
import { EntryRow } from '../components/EntryRow';
import { EmptyState } from '../components/EmptyState';
import { Money } from '../components/Money';
import { JobDot } from '../components/JobDot';
import { MonthCalendar } from '../components/MonthCalendar';
import { RestSheet } from '../components/RestSheet';
import { RestPlanSheet } from '../components/RestPlanSheet';
import {
  formatDateShort,
  formatMonthTitle,
  periodOf,
  relativeDayLabel,
  shiftPeriod,
  todayISO,
  weekdayCN,
} from '../lib/date';
import { formatHours } from '../lib/money';
import { plannedWorkDates, planStatusForJob } from '../lib/plan';
import { sumEntries, sumEntriesCapped } from '../lib/settlement';

interface RecordsProps {
  onAddEntry: () => void;
  onOpenEntry: (entryId: string) => void;
  onOpenJobs: () => void;
}

type ViewMode = 'list' | 'calendar';

function sortEntries(entries: Entry[]): Entry[] {
  return entries
    .slice()
    .sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''));
}

export function Records({ onAddEntry, onOpenEntry, onOpenJobs }: RecordsProps) {
  const { state } = useStore();
  const today = todayISO();
  const currentMonthStart = `${today.slice(0, 7)}-01`;
  const [anchor, setAnchor] = useState(today);
  const [jobFilter, setJobFilter] = useState<string>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [selectedDate, setSelectedDate] = useState(today);
  const [restSheetOpen, setRestSheetOpen] = useState(false);
  const [restPlanOpen, setRestPlanOpen] = useState(false);
  const [restPlanJobId, setRestPlanJobId] = useState<string | undefined>();
  const [restDate, setRestDate] = useState(today);
  const [restJobId, setRestJobId] = useState<string | undefined>();
  const monthPeriod = useMemo(
    () => periodOf('monthly', anchor, state.settings.weekStartsOn),
    [anchor, state.settings.weekStartsOn],
  );
  const isCurrentMonth = monthPeriod.start === currentMonthStart;
  const monthEntries = state.entries.filter(
    (entry) => entry.date >= monthPeriod.start && entry.date <= monthPeriod.end,
  );
  const monthRestDays = state.restDays.filter(
    (rest) => rest.date >= monthPeriod.start && rest.date <= monthPeriod.end,
  );
  const jobIdsInMonth = Array.from(
    new Set([
      ...monthEntries.map((entry) => entry.jobId),
      ...monthRestDays.map((rest) => rest.jobId),
    ]),
  );
  const filterJobs = state.jobs.filter((job) => jobIdsInMonth.includes(job.id));
  const visibleJob = filterJobs.find((job) => job.id === jobFilter);
  const effectiveFilter = jobFilter === 'all' || visibleJob ? jobFilter : 'all';
  const filtered =
    effectiveFilter === 'all'
      ? monthEntries
      : monthEntries.filter((entry) => entry.jobId === effectiveFilter);
  const filteredRestDays =
    effectiveFilter === 'all'
      ? monthRestDays
      : monthRestDays.filter((rest) => rest.jobId === effectiveFilter);
  const totals = sumEntriesCapped(filtered);
  const planJobs =
    effectiveFilter === 'all'
      ? state.jobs.filter((job) => !job.archived && job.workWeekdays)
      : state.jobs.filter(
          (job) =>
            job.id === effectiveFilter && !job.archived && job.workWeekdays,
        );
  const plannedDates = plannedWorkDates(
    planJobs,
    state.entries,
    state.restDays,
    monthPeriod.start,
    monthPeriod.end,
  ).filter((date) => date >= today);
  const selectedPlannedWork = plannedDates.includes(selectedDate);
  const selectedPlanJob = planJobs[0];
  const selectedPlanStatus = selectedPlanJob
    ? planStatusForJob(selectedPlanJob, selectedDate, state.entries, state.restDays)
    : 'none';
  const selectedEntries = sortEntries(filtered.filter((entry) => entry.date === selectedDate));
  const selectedRestDays = filteredRestDays.filter((rest) => rest.date === selectedDate);
  const selectedTotals = sumEntries(selectedEntries);
  const hasFixedMonthly = filtered.some(
    (entry) => entry.rule.payType === 'monthly' && entry.rule.monthlyMode === 'fixed',
  );

  const groups = new Map<string, Entry[]>();
  for (const entry of filtered) {
    const list = groups.get(entry.date);
    if (list) list.push(entry);
    else groups.set(entry.date, [entry]);
  }
  const dates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

  useEffect(() => {
    if (view !== 'calendar') return;
    if (selectedDate >= monthPeriod.start && selectedDate <= monthPeriod.end) return;
    const todayInMonth = today >= monthPeriod.start && today <= monthPeriod.end;
    if (todayInMonth) {
      setSelectedDate(today);
      return;
    }
    const firstWithEntries = [...filtered].map((entry) => entry.date).sort()[0];
    setSelectedDate(firstWithEntries ?? monthPeriod.start);
  }, [
    view,
    selectedDate,
    today,
    filtered,
    monthPeriod.start,
    monthPeriod.end,
  ]);

  const moveMonth = (delta: number) => {
    setAnchor(shiftPeriod(monthPeriod, delta, state.settings.weekStartsOn).start);
  };

  const switchView = () => {
    setView((current) => (current === 'list' ? 'calendar' : 'list'));
  };

  const openRest = (date: string, jobId?: string) => {
    setRestDate(date);
    const fixedMonthlyJob = state.jobs.find(
      (job) => !job.archived && job.rule.payType === 'monthly' && job.rule.monthlyMode === 'fixed',
    );
    setRestJobId(
      jobId ??
        (effectiveFilter !== 'all'
          ? effectiveFilter
          : selectedRestDays[0]?.jobId ??
            fixedMonthlyJob?.id ??
            filterJobs[0]?.id ??
            state.jobs[0]?.id),
    );
    setRestSheetOpen(true);
  };

  return (
    <div className="page records-page">
      <header className="page-heading page-heading--row">
        <div>
          <p className="eyebrow">逐日对账</p>
          <h1>工记</h1>
        </div>
        <div className="records-head-actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm records-view-btn"
            onClick={switchView}
            aria-label={view === 'list' ? '切换到日历视图' : '切换到列表视图'}
            title={view === 'list' ? '日历视图' : '列表视图'}
          >
            {view === 'list' ? <CalendarDays size={15} /> : <List size={15} />}
            {view === 'list' ? '日历' : '列表'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm records-rest-btn"
            onClick={() => {
              if (state.jobs.length === 0) {
                onOpenJobs();
                return;
              }
              openRest(view === 'calendar' ? selectedDate : today);
            }}
            aria-label="记休息"
            title="记休息"
          >
            <Coffee size={15} />
            休息
          </button>
          <button type="button" className="btn btn--soft btn--sm records-add-btn" onClick={onAddEntry}>
            <Plus size={15} />
            记一笔
          </button>
        </div>
      </header>

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
          onClick={() => setAnchor(today)}
          title="回到本月"
        >
          {formatMonthTitle(anchor)}
          {isCurrentMonth ? <span className="micro-badge">本月</span> : null}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => moveMonth(1)}
          disabled={isCurrentMonth}
          aria-label="下个月"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {view === 'list' && filtered.length > 0 ? (
        <section className="summary-card">
          <div className="summary-card-main">
            <span>收入合计</span>
            <Money value={totals.total} className="summary-amount" />
          </div>
          <div className="summary-stats">
            <div>
              <b>{totals.days}</b>
              <span>出勤 / 天</span>
            </div>
            <div>
              <b>{formatHours(totals.hours)}</b>
              <span>工时 / h</span>
            </div>
            <div>
              <b>{formatHours(totals.otHours)}</b>
              <span>加班 / h</span>
            </div>
          </div>
          {totals.capAdjustment > 0 ? (
            <p className="summary-note">月薪已按整月封顶，超出部分不计入。</p>
          ) : null}
          {filteredRestDays.length > 0 ? (
            <p className="summary-note summary-note--rest">
              <Coffee size={13} />
              本月另休 {filteredRestDays.length} 天
            </p>
          ) : null}
          {hasFixedMonthly ? (
            <p className="summary-note">月薪岗位的单日金额为折算参考，实际按整月发放。</p>
          ) : null}
        </section>
      ) : null}

      {filterJobs.length > 0 ? (
        <div className="filter-row" aria-label="按工作筛选">
          <button
            type="button"
            className={`filter-chip ${effectiveFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setJobFilter('all')}
          >
            全部
          </button>
          {filterJobs.map((job) => (
            <button
              type="button"
              key={job.id}
              className={`filter-chip ${effectiveFilter === job.id ? 'is-active' : ''}`}
              onClick={() => setJobFilter(job.id)}
            >
              <JobDot color={job.color} size={7} />
              {job.name}
            </button>
          ))}
        </div>
      ) : null}

      {view === 'calendar' ? (
        <>
          <section className="card calendar-card">
            <MonthCalendar
              monthStart={monthPeriod.start}
              entries={filtered}
              restDays={filteredRestDays}
              plannedWorkDates={plannedDates}
              jobs={state.jobs}
              weekStartsOn={state.settings.weekStartsOn}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
            />
          </section>
          <div className="calendar-detail-head">
            <div>
              <h2>
                {formatDateShort(selectedDate)}
                <span>{weekdayCN(selectedDate)}</span>
                {relativeDayLabel(selectedDate) ? (
                  <em className="micro-badge">{relativeDayLabel(selectedDate)}</em>
                ) : null}
              </h2>
              <p>
                {selectedEntries.length} 笔 · {formatHours(selectedTotals.hours)}h
                {selectedRestDays.length > 0 ? ` · 休息 ${selectedRestDays.length} 天` : ''}
                {selectedTotals.hours > 24 ? (
                  <em className="day-warning">当天合计超过 24h</em>
                ) : null}
              </p>
            </div>
            <Money value={selectedTotals.total} />
          </div>
          {selectedRestDays.length > 0 ? (
            <div className="card rest-day-list">
              {selectedRestDays.map((rest) => {
                const job = state.jobs.find((item) => item.id === rest.jobId);
                return (
                  <div className="rest-day-row" key={rest.id}>
                    <span className="rest-day-icon">
                      <Coffee size={16} />
                    </span>
                    <div>
                      <strong>休息</strong>
                      <p>
                        {job?.name ?? '工作'}
                        {rest.note ? ` · ${rest.note}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => openRest(rest.date, rest.jobId)}
                    >
                      管理
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}
          {selectedEntries.length > 0 ? (
            <div className="card list-card">
              {selectedEntries.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  job={state.jobs.find((job) => job.id === entry.jobId)}
                  onClick={() => onOpenEntry(entry.id)}
                />
              ))}
            </div>
          ) : selectedRestDays.length === 0 ? (
            <div className="card calendar-empty">
              <p>这天没有工记</p>
              {selectedPlannedWork ? (
                <p className="plan-day-note">按固定周排班，这天计划上班。</p>
              ) : selectedPlanStatus === 'off' ? (
                <p className="plan-day-note">按固定周排班，这天计划休息。</p>
              ) : null}
              <div className="calendar-empty-actions">
                <button
                  type="button"
                  className="btn btn--soft btn--sm"
                  onClick={state.jobs.length === 0 ? onOpenJobs : onAddEntry}
                >
                  {state.jobs.length === 0 ? '新建工作' : '补记一笔'}
                </button>
                {state.jobs.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => openRest(selectedDate)}
                  >
                    <Coffee size={14} />
                    标为休息
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : dates.length > 0 ? (
        <>
          <div className="record-groups">
            {dates.map((date) => {
              const dayEntries = groups.get(date) ?? [];
              const dayTotals = sumEntries(dayEntries);
              const relative = relativeDayLabel(date);
              return (
                <section className="record-group" key={date}>
                  <div className="record-day-head">
                    <div>
                      <h2>
                        {formatDateShort(date)}
                        <span>{weekdayCN(date)}</span>
                        {relative ? <em className="micro-badge">{relative}</em> : null}
                      </h2>
                      <p>
                        {dayEntries.length} 笔 · {formatHours(dayTotals.hours)}h
                        {dayTotals.hours > 24 ? (
                          <em className="day-warning">当天合计超过 24h</em>
                        ) : null}
                      </p>
                    </div>
                    <div className="record-day-total">
                      <Money value={dayTotals.total} />
                    </div>
                  </div>
                  <div className="card list-card">
                    {sortEntries(dayEntries).map((entry) => {
                      const job = state.jobs.find((item) => item.id === entry.jobId);
                      return (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          job={job}
                          onClick={() => onOpenEntry(entry.id)}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
          <button type="button" className="records-add-link" onClick={onAddEntry}>
            <span>+</span>
            补记一笔工
          </button>
        </>
      ) : (
        <div className="card empty-card">
          <EmptyState
            icon={ClipboardList}
            title={
              monthEntries.length === 0
                ? `${formatMonthTitle(anchor)}还没有记录`
                : '这个筛选下没有记录'
            }
            description={
              state.jobs.length === 0
                ? '先建一份工作，设置单价和结算周期。'
                : monthEntries.length === 0
                  ? '记下今天干了多久，工钱自动算。'
                  : '换一个工作筛选，或者记一笔新的。'
            }
            actionLabel={state.jobs.length === 0 ? '新建工作' : '记一笔'}
            onAction={state.jobs.length === 0 ? onOpenJobs : onAddEntry}
          />
        </div>
      )}

      <RestSheet
        open={restSheetOpen}
        jobs={state.jobs.filter((job) => !job.archived)}
        initialJobId={restJobId}
        initialDate={restDate}
        onPlan={() => {
          setRestPlanJobId(restJobId);
          setRestSheetOpen(false);
          setRestPlanOpen(true);
        }}
        onClose={() => setRestSheetOpen(false)}
      />

      <RestPlanSheet
        open={restPlanOpen}
        jobs={state.jobs.filter((job) => !job.archived)}
        initialJobId={restPlanJobId}
        onClose={() => setRestPlanOpen(false)}
      />
    </div>
  );
}
