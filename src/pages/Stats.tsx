import { useMemo, useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, Target } from 'lucide-react';
import { useStore } from '../store';
import type { Period, Totals } from '../types';
import { BarChart } from '../components/BarChart';
import { EmptyState } from '../components/EmptyState';
import { Money } from '../components/Money';
import { Segmented } from '../components/Segmented';
import {
  periodOf,
  shiftPeriod,
  todayISO,
  weekdayShort,
} from '../lib/date';
import { formatHours } from '../lib/money';
import { formatRestDays, totalRestDays } from '../lib/rest';
import { jobColor } from '../lib/meta';
import { buildHeatmap, heatmapAriaLabel } from '../lib/insights';
import {
  dailySeries,
  jobBreakdown,
  sumEntries,
  sumEntriesCapped,
} from '../lib/settlement';
import { buildYearSummary, shiftYear, yearPeriod } from '../lib/yearStats';
import { payTypeBreakdown } from '../lib/categoryStats';
import { monthlyBudgetStatus } from '../lib/budget';

type Mode = 'week' | 'month' | 'year';

interface StatsProps {
  onAddEntry: () => void;
}

export function Stats({ onAddEntry }: StatsProps) {
  const { state } = useStore();
  const today = todayISO();
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(today);
  const year = useMemo(() => yearPeriod(anchor), [anchor]);
  const period: Period = useMemo(() => {
    if (mode === 'year') {
      return {
        start: year.start,
        end: year.end,
        key: `yearly:${year.year}`,
        label: year.label,
        shortLabel: `${year.year}年`,
      };
    }
    return periodOf(
      mode === 'week' ? 'weekly' : 'monthly',
      anchor,
      state.settings.weekStartsOn,
    );
  }, [mode, anchor, year, state.settings.weekStartsOn]);
  const entries = useMemo(
    () =>
      state.entries.filter(
        (entry) => entry.date >= period.start && entry.date <= period.end,
      ),
    [state.entries, period.start, period.end],
  );
  const restDays = useMemo(
    () =>
      state.restDays.filter(
        (rest) => rest.date >= period.start && rest.date <= period.end,
      ),
    [state.restDays, period.start, period.end],
  );
  const restTotal = totalRestDays(restDays);
  const yearSummary = useMemo(
    () => (mode === 'year' ? buildYearSummary(state.entries, year.year) : null),
    [mode, state.entries, year.year],
  );
  const totals: Totals = useMemo(() => {
    if (yearSummary) return yearSummary.totals;
    return mode === 'month' ? sumEntriesCapped(entries) : sumEntries(entries);
  }, [yearSummary, mode, entries]);
  const series = useMemo(() => {
    if (yearSummary) {
      const currentMonth = today.slice(0, 7);
      return yearSummary.months.map((month) => ({
        date: month.date,
        label: String(month.month),
        value: month.earnings,
        highlight: month.date.slice(0, 7) === currentMonth,
      }));
    }
    return dailySeries(entries, period.start, period.end).map((point) => ({
      date: point.date,
      label: mode === 'week' ? weekdayShort(point.date) : String(Number(point.date.slice(8))),
      value: point.earnings,
      highlight: point.date === today,
    }));
  }, [yearSummary, entries, period.start, period.end, mode, today]);
  const breakdown = useMemo(() => {
    const rows = yearSummary
      ? yearSummary.breakdown
      : jobBreakdown(entries, mode === 'month');
    return rows.map((item) => ({
      ...item,
      job: state.jobs.find((job) => job.id === item.jobId),
    }));
  }, [yearSummary, entries, mode, state.jobs]);
  const jobTotal = breakdown.reduce((sum, item) => sum + item.total, 0);
  const categories = useMemo(
    () => payTypeBreakdown(entries, mode !== 'week'),
    [entries, mode],
  );
  const categoryTotal = categories.reduce((sum, item) => sum + item.total, 0);
  const avgHourly = totals.hours > 0 ? totals.total / totals.hours : 0;
  const hasFixedMonthly = entries.some(
    (entry) => entry.rule.payType === 'monthly' && entry.rule.monthlyMode === 'fixed',
  );
  const overtimeShare = totals.hours > 0 ? (totals.otHours / totals.hours) * 100 : 0;
  const positiveTotal = totals.base + totals.otPay + totals.bonus;
  const canGoNext = period.end < today;
  const isCurrent = today >= period.start && today <= period.end;
  const budget = mode === 'month' && isCurrent
    ? monthlyBudgetStatus(state.settings.budget, entries, today)
    : null;
  const heatmap = buildHeatmap(state.entries, {
    today,
    weekStartsOn: state.settings.weekStartsOn,
  });

  const switchMode = (next: Mode) => {
    setMode(next);
    setAnchor(today);
  };

  const goPrev = () => {
    if (mode === 'year') {
      setAnchor(shiftYear(year, -1).start);
      return;
    }
    setAnchor(shiftPeriod(period, -1, state.settings.weekStartsOn).start);
  };

  const goNext = () => {
    if (mode === 'year') {
      setAnchor(shiftYear(year, 1).start);
      return;
    }
    setAnchor(shiftPeriod(period, 1, state.settings.weekStartsOn).start);
  };

  const periodBadge = mode === 'week' ? '本周' : mode === 'month' ? '本月' : '本年';

  return (
    <div className="page stats-page">
      <header className="page-heading page-heading--row">
        <div>
          <p className="eyebrow">看清工时与收入</p>
          <h1>工资统计</h1>
        </div>
        <Segmented
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'week', label: '本周' },
            { value: 'month', label: '本月' },
            { value: 'year', label: '本年' },
          ]}
          size="sm"
          ariaLabel="统计周期"
        />
      </header>

      <div className="month-switch">
        <button
          type="button"
          className="icon-button"
          onClick={goPrev}
          aria-label={mode === 'year' ? '上一年' : '上一个周期'}
        >
          <ChevronLeft size={20} />
        </button>
        <button
          type="button"
          className="month-switch-label"
          onClick={() => setAnchor(today)}
          title={mode === 'year' ? '回到今年' : '回到本期'}
        >
          {period.label}
          {isCurrent ? <span className="micro-badge">{periodBadge}</span> : null}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={goNext}
          disabled={!canGoNext}
          aria-label={mode === 'year' ? '下一年' : '下一个周期'}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="card empty-card">
          <EmptyState
            icon={BarChart3}
            title={
              mode === 'year'
                ? `${year.year} 年还没有工记`
                : '这段时间还没有工记'
            }
            description="记上工时，收入、加班和平均时薪会自动汇总。"
            actionLabel="记一笔"
            onAction={onAddEntry}
          />
        </div>
      ) : (
        <>
          <section className="stats-hero">
            <div className="stats-hero-orb" aria-hidden="true" />
            <div className="stats-hero-top">
              <span>{mode === 'year' ? '本年收入' : '本期收入'}</span>
              <span className="stats-period">
                {entries.length} 笔工记{restTotal > 0 ? ` · 休 ${formatRestDays(restTotal)} 天` : ''}
              </span>
            </div>
            <Money value={totals.total} className="stats-amount" />
            <div className="stats-metrics">
              <div>
                <span>出勤</span>
                <strong>{totals.days} 天</strong>
              </div>
              <div>
                <span>工时</span>
                <strong>{formatHours(totals.hours)}h</strong>
              </div>
              {hasFixedMonthly ? (
                <div>
                  <span>休息</span>
                  <strong>{formatRestDays(restTotal)} 天</strong>
                </div>
              ) : (
                <div>
                  <span>平均时薪</span>
                  <strong>
                    <Money value={avgHourly} />
                  </strong>
                </div>
              )}
              <div>
                <span>加班占比</span>
                <strong>{overtimeShare.toFixed(0)}%</strong>
              </div>
            </div>
          </section>

          {budget ? (
            <section className={`card budget-card ${budget.alert ? `is-${budget.alert.tone}` : ''}`}>
              <div className="section-head section-head--tight">
                <div>
                  <h2><Target size={17} /> 本月预算</h2>
                  <p>收入目标与工时上限 · 不含未来工记</p>
                </div>
                {budget.alert ? <span className="micro-badge">{budget.alert.tone === 'warning' ? '注意' : '进度'}</span> : null}
              </div>
              {budget.incomeTarget > 0 ? (
                <div className="budget-metric">
                  <div><span>收入目标</span><strong><Money value={budget.income} /> / <Money value={budget.incomeTarget} /></strong></div>
                  <div className="budget-track" aria-label={`收入目标完成 ${Math.floor(budget.incomePercent)}%`}>
                    <span style={{ width: `${Math.min(100, Math.max(0, budget.incomePercent))}%` }} />
                  </div>
                  <em>{Math.floor(budget.incomePercent)}%</em>
                </div>
              ) : null}
              {budget.hoursLimit > 0 ? (
                <div className="budget-metric">
                  <div><span>工时上限</span><strong>{formatHours(budget.hours)}h / {formatHours(budget.hoursLimit)}h</strong></div>
                  <div className="budget-track budget-track--hours" aria-label={`工时上限使用 ${Math.floor(budget.hoursPercent)}%`}>
                    <span style={{ width: `${Math.min(100, Math.max(0, budget.hoursPercent))}%` }} />
                  </div>
                  <em>{Math.floor(budget.hoursPercent)}%</em>
                </div>
              ) : null}
              {budget.alert ? <p className="budget-alert">{budget.alert.message}</p> : <p className="field-hint">达到 80% 时提醒，达到目标或上限时再次提示。</p>}
            </section>
          ) : null}

          {heatmap.totalHours > 0 ? (
            <section className="card heat-card">
              <div className="section-head section-head--tight">
                <div>
                  <h2>最近 12 周</h2>
                  <p>颜色越深，干活越多</p>
                </div>
                <span className="heat-total">{formatHours(heatmap.totalHours)}h</span>
              </div>
              <div className="heat-grid" role="img" aria-label={heatmapAriaLabel(heatmap)}>
                {heatmap.weeks.map((week) => (
                  <div className="heat-week" key={week.start}>
                    {week.days.map((day) => (
                      <span
                        key={day.date}
                        className={[
                          'heat-day',
                          `heat-day--${day.level}`,
                          day.isFuture ? 'is-future' : '',
                          day.isToday ? 'is-today' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={`${day.date} · ${formatHours(day.hours)}h`}
                      />
                    ))}
                  </div>
                ))}
              </div>
              <div className="heat-legend">
                <span>少</span>
                {[1, 2, 3, 4].map((level) => (
                  <i key={level} className={`heat-day heat-day--${level}`} />
                ))}
                <span>多</span>
                <em>12 周 · {formatHours(heatmap.totalHours)}h</em>
              </div>
            </section>
          ) : null}

          <section className="card chart-card">
            <div className="section-head section-head--tight">
              <div>
                <h2>{mode === 'year' ? '每月收入' : '每天的收入'}</h2>
                <p>
                  {mode === 'year' ? '1–12 月 · 峰值 ' : '峰值 '}
                  <Money value={Math.max(...series.map((point) => point.value), 0)} />
                  {hasFixedMonthly
                    ? mode === 'year'
                      ? ' · 固定月薪逐月封顶'
                      : ' · 固定月薪按出勤日分摊'
                    : ''}
                </p>
              </div>
              <span className="chart-legend">
                <i />
                {mode === 'year' ? '月收入' : '日收入'}
              </span>
            </div>
            <BarChart
              data={series}
              height={178}
              labelEvery={mode === 'month' ? 5 : 1}
              showGrid
            />
            {mode === 'year' ? (
              <p className="calc-note">月薪工作逐月封顶；柱状图之和等于上方年度收入。</p>
            ) : totals.capAdjustment > 0 ? (
              <p className="calc-note">月薪工作已按整月封顶，图表为单日折算展示。</p>
            ) : null}
          </section>

          <section className="card composition-card">
            <div className="section-head section-head--tight">
              <div>
                <h2>收入构成</h2>
                <p>基础、加班和奖金</p>
              </div>
            </div>
            {positiveTotal > 0 ? (
              <div className="stack-bar" aria-hidden="true">
                <span
                  className="stack-seg stack-seg--base"
                  style={{ width: `${(totals.base / positiveTotal) * 100}%` }}
                />
                <span
                  className="stack-seg stack-seg--ot"
                  style={{ width: `${(totals.otPay / positiveTotal) * 100}%` }}
                />
                <span
                  className="stack-seg stack-seg--bonus"
                  style={{ width: `${(totals.bonus / positiveTotal) * 100}%` }}
                />
              </div>
            ) : null}
            <div className="composition-list">
              <div className="composition-row">
                <span>
                  <i className="legend-base" />
                  基础工资
                </span>
                <Money value={totals.base} />
              </div>
              <div className="composition-row">
                <span>
                  <i className="legend-ot" />
                  加班费
                </span>
                <Money value={totals.otPay} />
              </div>
              {totals.bonus > 0 ? (
                <div className="composition-row">
                  <span>
                    <i className="legend-bonus" />
                    奖金补贴
                  </span>
                  <Money value={totals.bonus} />
                </div>
              ) : null}
              {totals.deduction > 0 ? (
                <div className="composition-row is-deduct">
                  <span>
                    <i className="legend-deduct" />
                    扣款
                  </span>
                  <Money value={-totals.deduction} />
                </div>
              ) : null}
            </div>
          </section>

          <section className="card distribution-card category-card">
            <div className="section-head section-head--tight">
              <div>
                <h2>分类统计</h2>
                <p>按时薪、日薪、月薪和计件看收入</p>
              </div>
              <span className="count-pill">{categories.length}</span>
            </div>
            <div className="distribution-list">
              {categories.map((item, index) => {
                const percent = categoryTotal !== 0 ? (item.total / categoryTotal) * 100 : 0;
                const colors = ['#146b4b', '#c48128', '#44708c', '#7c5874'];
                return (
                  <div className="distribution-row" key={item.payType}>
                    <div className="distribution-head">
                      <span><i style={{ background: colors[index % colors.length] }} />{item.label}</span>
                      <strong><Money value={item.total} /></strong>
                    </div>
                    <div className="distribution-bar"><span style={{ width: `${Math.max(2, percent)}%`, background: colors[index % colors.length] }} /></div>
                    <div className="distribution-meta">
                      <span>{item.count} 笔 · {item.days} 天 · {formatHours(item.hours)}h</span>
                      <span>{Math.round(percent)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card distribution-card">
            <div className="section-head section-head--tight">
              <div>
                <h2>工作分布</h2>
                <p>哪份工作挣得多</p>
              </div>
              <span className="count-pill">{breakdown.length}</span>
            </div>
            <div className="distribution-list">
              {breakdown.map((item) => {
                const meta = jobColor(item.job?.color ?? 'pine');
                const width = jobTotal > 0 ? Math.max(4, (item.total / jobTotal) * 100) : 0;
                return (
                  <div className="distribution-row" key={item.jobId}>
                    <div className="distribution-head">
                      <span>
                        <i style={{ background: meta.main }} />
                        {item.job?.name ?? '未知工作'}
                      </span>
                      <strong>
                        <Money value={item.total} />
                      </strong>
                    </div>
                    <div className="distribution-bar">
                      <span
                        style={{
                          width: `${width}%`,
                          background: meta.main,
                        }}
                      />
                    </div>
                    <div className="distribution-meta">
                      <span>{item.days} 天 · {formatHours(item.hours)}h</span>
                      <span>{jobTotal > 0 ? Math.round((item.total / jobTotal) * 100) : 0}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <p className="stats-footnote">
            平均时薪 = 统计区间收入 ÷ 统计区间工时；加班占比 = 加班工时 ÷ 总工时。
            {mode === 'year' ? '年度收入按每月实发口径累加，休息天数按记录的去重日期统计。' : ''}
          </p>
        </>
      )}
    </div>
  );
}
