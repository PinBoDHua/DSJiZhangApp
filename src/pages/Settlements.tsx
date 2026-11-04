import type { CSSProperties } from 'react';
import { ArrowUpRight, CheckCircle2, ClipboardList } from 'lucide-react';
import { useStore } from '../store';
import { EmptyState } from '../components/EmptyState';
import { JobDot } from '../components/JobDot';
import { Money } from '../components/Money';
import { formatDateShort } from '../lib/date';
import { formatHours } from '../lib/money';
import { CYCLE_LABEL, jobColor } from '../lib/meta';
import { getSettlementOverview } from '../lib/settlement';

interface SettlementsProps {
  onOpenDraft: (jobId: string, periodStart: string) => void;
  onOpenRecord: (settlementId: string) => void;
  onAddEntry: () => void;
  onOpenJobs: () => void;
}

export function Settlements({
  onOpenDraft,
  onOpenRecord,
  onAddEntry,
  onOpenJobs,
}: SettlementsProps) {
  const { state } = useStore();
  const overview = getSettlementOverview(state);
  const history = [...state.settlements].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingJobs = overview.jobs.filter((item) => item.draft.entries.length > 0);
  const hasPending = overview.jobs.length > 0;
  const clear = pendingJobs.length === 0 && overview.advanceTotal === 0;

  return (
    <div className="page settlements-page">
      <header className="page-heading">
        <p className="eyebrow">算清每一笔</p>
        <h1>结算</h1>
      </header>

      <section className={`receipt ${clear ? 'receipt--clear' : ''}`}>
        <div className="receipt-top">
          <span>{clear ? '工钱状态' : overview.outstanding < 0 ? '借支待抵' : '未结工钱'}</span>
          <span className="receipt-badge">
            {clear ? <CheckCircle2 size={13} /> : null}
            {clear ? '全部结清' : '截至今天'}
          </span>
        </div>
        {clear ? (
          <div className="receipt-clear">
            <strong>都结清了</strong>
            <p>每一笔工钱都有交代。</p>
          </div>
        ) : (
          <>
            <Money value={Math.abs(overview.outstanding)} className="receipt-amount" />
            <p className="receipt-caption">
              {overview.outstanding < 0
                ? '借支还没抵完，记一笔工就能继续抵扣'
                : pendingJobs.length > 0
                  ? `${pendingJobs.length} 份工作待结算`
                  : '记一笔工就能结清'}
            </p>
          </>
        )}
        <div className="receipt-divider" aria-hidden="true" />
        <div className="receipt-stats">
          <div>
            <span>累计工时</span>
            <strong>{formatHours(overview.totals.hours)}h</strong>
          </div>
          <div>
            <span>出勤</span>
            <strong>{overview.totals.days} 天</strong>
          </div>
          <div>
            <span>借支待抵</span>
            <strong>
              <Money value={overview.advanceTotal} />
            </strong>
          </div>
        </div>
      </section>

      {hasPending ? (
        <section className="section-block">
          <div className="section-head">
            <div>
              <h2>待结算</h2>
              <p>按每份工作的周期逐期结清</p>
            </div>
            <span className="count-pill">{overview.jobs.length}</span>
          </div>
          <div className="settle-list">
            {overview.jobs.map((item) => {
              const { job, draft, otherPeriods, outstanding } = item;
              const hasEntries = draft.entries.length > 0;
              const meta = jobColor(job.color);
              return (
                <button
                  type="button"
                  className="settle-card"
                  key={job.id}
                  style={{ '--job-color': meta.main } as CSSProperties}
                  onClick={() => onOpenDraft(job.id, draft.period.start)}
                >
                  <div className="settle-card-top">
                    <span className="settle-job">
                      <JobDot color={job.color} size={9} ring />
                      {job.name}
                    </span>
                    <span className="cycle-pill">{CYCLE_LABEL[job.cycle]}</span>
                  </div>
                  <p className="settle-period">
                    {draft.period.label}
                    {otherPeriods > 0 ? <em>另有 {otherPeriods} 期未结</em> : null}
                  </p>
                  <div className="settle-card-amount">
                    <span>{hasEntries ? '本期应结' : '借支待抵扣'}</span>
                    <Money value={hasEntries ? draft.net : draft.advanceTotal} />
                  </div>
                  <div className="settle-meta">
                    <span>{draft.days} 天</span>
                    <span>{formatHours(draft.hours)}h</span>
                    {draft.otHours > 0 ? <span>加班 {formatHours(draft.otHours)}h</span> : null}
                    {draft.advanceTotal > 0 ? (
                      <span className="is-advance">
                        借支 −<Money value={draft.advanceTotal} />
                      </span>
                    ) : null}
                    {!hasEntries ? <span className="is-warn">暂无工记</span> : null}
                  </div>
                  <div className="settle-card-foot">
                    <span>
                      未结合计 <Money value={outstanding} />
                    </span>
                    <span className="settle-action">
                      {hasEntries ? '核对结算' : '查看'}
                      <ArrowUpRight size={14} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : state.jobs.length > 0 ? (
        <section className="card clear-card">
          <EmptyState
            icon={CheckCircle2}
            title="所有工钱都结清了"
            description="新的工记会自动进入下一期结算。"
            actionLabel="记一笔"
            onAction={onAddEntry}
            compact
          />
        </section>
      ) : (
        <section className="card clear-card">
          <EmptyState
            icon={ClipboardList}
            title="还没有工作"
            description="先建一份工作，记完工就能结算。"
            actionLabel="新建工作"
            onAction={onOpenJobs}
            compact
          />
        </section>
      )}

      <section className="section-block">
        <div className="section-head">
          <div>
            <h2>结算历史</h2>
            <p>每一张都留底，可随时翻看</p>
          </div>
          {history.length > 0 ? <span className="count-pill">{history.length}</span> : null}
        </div>
        {history.length > 0 ? (
          <div className="card list-card">
            {history.map((settlement) => (
              <button
                type="button"
                key={settlement.id}
                className="history-row"
                onClick={() => onOpenRecord(settlement.id)}
              >
                <span className="history-icon">
                  <JobDot
                    color={state.jobs.find((job) => job.id === settlement.jobId)?.color ?? 'pine'}
                    size={9}
                  />
                </span>
                <span className="history-main">
                  <span className="history-job">{settlement.jobName}</span>
                  <span className="history-meta">
                    {formatDateShort(settlement.periodStart)} –{' '}
                    {formatDateShort(settlement.periodEnd)} · {CYCLE_LABEL[settlement.cycle]}
                  </span>
                </span>
                <span className="history-amount">
                  <Money value={settlement.net} />
                  <span>已结</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="history-empty">
            <CheckCircle2 size={16} />
            结算后会在这里留底，随时可以复制对账。
          </div>
        )}
      </section>

      <p className="settle-footnote">
        结算后记录会锁定；如果发现算错，可以在结算历史里撤销重来。
      </p>
    </div>
  );
}
