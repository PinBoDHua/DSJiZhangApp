import { useState } from 'react';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
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
import { jobColor } from '../lib/meta';
import {
  dailySeries,
  jobBreakdown,
  sumEntries,
  sumEntriesCapped,
} from '../lib/settlement';

type Mode = 'week' | 'month';

interface StatsProps {
  onAddEntry: () => void;
}

export function Stats({ onAddEntry }: StatsProps) {
  const { state } = useStore();
  const today = todayISO();
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState(today);
  const cycle = mode === 'week' ? 'weekly' : 'monthly';
  const period = periodOf(cycle, anchor, state.settings.weekStartsOn);
  const entries = state.entries.filter(
    (entry) => entry.date >= period.start && entry.date <= period.end,
  );
  const restDays = state.restDays.filter(
    (rest) => rest.date >= period.start && rest.date <= period.end,
  );
  const totals = mode === 'month' ? sumEntriesCapped(entries) : sumEntries(entries);
  const series = dailySeries(entries, period.start, period.end).map((point) => ({
    date: point.date,
    label: mode === 'week' ? weekdayShort(point.date) : String(Number(point.date.slice(8))),
    value: point.earnings,
    highlight: point.date === today,
  }));
  const breakdown = jobBreakdown(entries, mode === 'month').map((item) => ({
    ...item,
    job: state.jobs.find((job) => job.id === item.jobId),
  }));
  const jobTotal = breakdown.reduce((sum, item) => sum + item.total, 0);
  const avgHourly = totals.hours > 0 ? totals.total / totals.hours : 0;
  const overtimeShare = totals.hours > 0 ? (totals.otHours / totals.hours) * 100 : 0;
  const positiveTotal = totals.base + totals.otPay + totals.bonus;
  const canGoNext = period.end < today;
  const isCurrent = today >= period.start && today <= period.end;

  const switchMode = (next: Mode) => {
    setMode(next);
    setAnchor(today);
  };

  return (
    <div className="page stats-page">
      <header className="page-heading page-heading--row">
        <div>
          <p className="eyebrow">钱去哪了</p>
          <h1>统计</h1>
        </div>
        <Segmented
          value={mode}
          onChange={switchMode}
          options={[
            { value: 'week', label: '本周' },
            { value: 'month', label: '本月' },
          ]}
          size="sm"
          ariaLabel="统计周期"
        />
      </header>

      <div className="month-switch">
        <button
          type="button"
          className="icon-button"
          onClick={() => setAnchor(shiftPeriod(period, -1, state.settings.weekStartsOn).start)}
          aria-label="上一个周期"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          type="button"
          className="month-switch-label"
          onClick={() => setAnchor(today)}
          title="回到本期"
        >
          {period.label}
          {isCurrent ? <span className="micro-badge">{mode === 'week' ? '本周' : '本月'}</span> : null}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => setAnchor(shiftPeriod(period, 1, state.settings.weekStartsOn).start)}
          disabled={!canGoNext}
          aria-label="下一个周期"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="card empty-card">
          <EmptyState
            icon={BarChart3}
            title="这段时间还没有工记"
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
              <span>本期收入</span>
              <span className="stats-period">
                {entries.length} 笔工记{restDays.length > 0 ? ` · 休 ${restDays.length} 天` : ''}
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
              <div>
                <span>平均时薪</span>
                <strong>
                  <Money value={avgHourly} />
                </strong>
              </div>
              <div>
                <span>加班占比</span>
                <strong>{overtimeShare.toFixed(0)}%</strong>
              </div>
            </div>
          </section>

          <section className="card chart-card">
            <div className="section-head section-head--tight">
              <div>
                <h2>每天的收入</h2>
                <p>
                  峰值{' '}
                  <Money value={Math.max(...series.map((point) => point.value), 0)} />
                </p>
              </div>
              <span className="chart-legend">
                <i />
                日收入
              </span>
            </div>
            <BarChart
              data={series}
              height={178}
              labelEvery={mode === 'week' ? 1 : 5}
              showGrid
            />
            {totals.capAdjustment > 0 ? (
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
            平均时薪 = 本期收入 ÷ 本期工时；加班占比 = 加班工时 ÷ 总工时。
          </p>
        </>
      )}
    </div>
  );
}
