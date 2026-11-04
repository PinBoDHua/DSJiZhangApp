import { useState } from 'react';
import { Briefcase, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { EmptyState } from '../components/EmptyState';
import { JobDot } from '../components/JobDot';
import { Money } from '../components/Money';
import { SubPage } from '../components/SubPage';
import { CYCLE_LABEL, jobColor, rateLabel } from '../lib/meta';
import { getSettlementOverview } from '../lib/settlement';

interface JobsProps {
  onBack: () => void;
  onAdd: () => void;
  onTemplate: () => void;
  onEdit: (jobId: string) => void;
}

export function Jobs({ onBack, onAdd, onTemplate, onEdit }: JobsProps) {
  const { state } = useStore();
  const [showArchived, setShowArchived] = useState(false);
  const overview = getSettlementOverview(state);
  const pendingByJob = new Map(overview.jobs.map((item) => [item.job.id, item.outstanding]));
  const active = state.jobs.filter((job) => !job.archived);
  const archived = state.jobs.filter((job) => job.archived);

  const renderJob = (jobId: string) => {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return null;
    const meta = jobColor(job.color);
    const pending = pendingByJob.get(job.id) ?? 0;
    return (
      <button type="button" className="job-manage-card" key={job.id} onClick={() => onEdit(job.id)}>
        <span className="job-manage-bar" style={{ background: meta.main }} />
        <span className="job-manage-main">
          <span className="job-manage-title">
            <JobDot color={job.color} size={9} ring />
            <strong>{job.name}</strong>
            {job.archived ? <em className="micro-badge">已归档</em> : null}
          </span>
          {job.employer ? <span className="job-manage-employer">{job.employer}</span> : null}
          <span className="job-manage-meta">
            {rateLabel(job.rule.payType, job.rule.rate, job.rule.unitLabel)} ·{' '}
            {CYCLE_LABEL[job.cycle]} ·{' '}
            {job.rule.otEnabled ? `加班 ${job.rule.weekdayOT}× 起` : '不含加班费'}
          </span>
        </span>
        <span className="job-manage-tail">
          {pending !== 0 ? (
            <span className="job-pending-badge">
              {pending < 0 ? '待抵' : '待结'} <Money value={Math.abs(pending)} />
            </span>
          ) : (
            <span className="job-clear-badge">已结清</span>
          )}
          <ChevronRight size={17} />
        </span>
      </button>
    );
  };

  return (
    <SubPage
      title="工作管理"
      subtitle="每份工作单独算账"
      onBack={onBack}
      footer={
        <button type="button" className="btn btn--primary btn--block" onClick={onAdd}>
          <Plus size={18} />
          新建工作
        </button>
      }
    >
      <button type="button" className="longterm-template" onClick={onTemplate}>
        <span className="longterm-template-icon">
          <Sparkles size={19} />
        </span>
        <span className="longterm-template-copy">
          <strong>长期工模板</strong>
          <em>3500 元 · 月休 5 天 · 6h + 午休 2h</em>
        </span>
        <ChevronRight size={17} />
      </button>

      {active.length > 0 ? (
        <section className="section-block">
          <div className="section-head">
            <div>
              <h2>进行中</h2>
              <p>{active.length} 份工作</p>
            </div>
          </div>
          <div className="job-manage-list">{active.map((job) => renderJob(job.id))}</div>
        </section>
      ) : (
        <div className="card">
          <EmptyState
            icon={Briefcase}
            title="还没有工作"
            description="建一份工作，填好单价和结算周期，就能开始记工。"
            actionLabel="新建工作"
            onAction={onAdd}
          />
        </div>
      )}

      {archived.length > 0 ? (
        <section className="section-block">
          <button
            type="button"
            className="archived-toggle"
            onClick={() => setShowArchived((value) => !value)}
            aria-expanded={showArchived}
          >
            <span>已归档 · {archived.length} 份</span>
            <ChevronRight size={16} className={showArchived ? 'is-open' : ''} />
          </button>
          {showArchived ? (
            <div className="job-manage-list">{archived.map((job) => renderJob(job.id))}</div>
          ) : null}
        </section>
      ) : null}

      <p className="jobs-footnote">
        修改单价只影响之后的新工记；历史记录会保留当时的单价和规则。
      </p>
    </SubPage>
  );
}
