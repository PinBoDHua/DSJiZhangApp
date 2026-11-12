import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  CircleAlert,
  Info,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { SubPage } from '../components/SubPage';
import { EmptyState } from '../components/EmptyState';
import { useStore } from '../store';
import {
  applySafeFixes,
  checkLedger,
  healthBadgeText,
  type HealthIssue,
  type HealthReport,
  type HealthSeverity,
} from '../lib/health';
import { getLastBackupAt } from '../lib/backupStatus';
import { saveSnapshot } from '../lib/snapshots';

interface HealthProps {
  onBack: () => void;
  onNavigate?: (target: 'records' | 'settlements' | 'jobs') => void;
}

const GROUPS: Array<{
  severity: HealthSeverity;
  title: string;
  hint: string;
  icon: typeof CircleAlert;
}> = [
  { severity: 'critical', title: '严重', hint: '金额可能算错，建议先处理', icon: TriangleAlert },
  { severity: 'warning', title: '提醒', hint: '可能录错，需要你看一眼', icon: CircleAlert },
  { severity: 'info', title: '提示', hint: '正常但值得知道', icon: Info },
];

export function Health({ onBack, onNavigate }: HealthProps) {
  const { state, replaceState, toast } = useStore();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setReport(checkLedger(state, { lastBackupAt: getLastBackupAt() }));
  }, [state]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fixOrphanLocks = async (issue: HealthIssue) => {
    if (issue.code !== 'orphan-settlement-lock') return;
    setBusy(true);
    try {
      await saveSnapshot(state, 'manual');
    } catch {
      // 快照失败仍允许修复，Toast 里说明
    }
    const fixed = applySafeFixes(state, [issue.code]);
    if (fixed.fixed > 0) {
      if (!replaceState(fixed.state)) {
        toast('本机存储写入失败，操作未生效，请先导出备份', 'error');
      } else {
        toast(`已解锁 ${fixed.fixed} 条记录，可以重新结算了`, 'success');
      }
    } else {
      toast('没有需要解锁的记录', 'info');
    }
    setBusy(false);
  };

  const navigateFor = (issue: HealthIssue) => {
    if (!onNavigate) return;
    if (issue.code.startsWith('settlement') || issue.code === 'payment-over-net') {
      onNavigate('settlements');
      return;
    }
    if (issue.code === 'orphan-job' || issue.code === 'empty-job') {
      onNavigate('jobs');
      return;
    }
    onNavigate('records');
  };

  return (
    <SubPage
      title="账本体检"
      subtitle={report ? healthBadgeText(report) : '正在检查…'}
      onBack={onBack}
      action={
        <button
          type="button"
          className="btn btn--soft btn--sm"
          onClick={refresh}
          disabled={busy}
        >
          <RefreshCw size={14} />
          重新检查
        </button>
      }
    >
      {!report ? (
        <p className="snap-loading">正在检查账本…</p>
      ) : report.issues.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="账本一切正常"
          description="没有发现金额不一致、孤儿锁定或重复结算。定期体检一次，心里更有底。"
        />
      ) : (
        <>
          <div className="health-summary">
            <span className="health-summary-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <strong>
                {report.counts.critical > 0
                  ? `发现 ${report.counts.critical} 项严重问题`
                  : report.counts.warning > 0
                    ? `发现 ${report.counts.warning} 项提醒`
                    : '只有提示项'}
              </strong>
              <p>
                体检只读，不会自动改金额。唯一会自动修复的是「工记 / 借支锁定在已删除结算上」。
              </p>
            </div>
          </div>

          {GROUPS.map((group) => {
            const items = report.issues.filter((issue) => issue.severity === group.severity);
            if (items.length === 0) return null;
            const Icon = group.icon;
            return (
              <section className="health-group" key={group.severity}>
                <header className="health-group-head">
                  <span className={`health-severity health-severity--${group.severity}`}>
                    <Icon size={14} />
                    {group.title}
                  </span>
                  <p>{group.hint}</p>
                </header>
                <ul className="health-list">
                  {items.map((issue) => (
                    <li className="health-item" key={issue.code}>
                      <div className="health-item-head">
                        <strong>{issue.title}</strong>
                        {issue.count > 0 ? <span>{issue.count}</span> : null}
                      </div>
                      <p>{issue.detail}</p>
                      <div className="health-item-actions">
                        {issue.fixable ? (
                          <button
                            type="button"
                            className="btn btn--soft btn--sm"
                            onClick={() => void fixOrphanLocks(issue)}
                            disabled={busy}
                          >
                            <Wrench size={14} />
                            一键解锁
                          </button>
                        ) : null}
                        {onNavigate ? (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => navigateFor(issue)}
                          >
                            去处理
                            <ArrowRight size={14} />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <p className="health-foot">
            体检结果只在本机计算，不会上传。处理后回到本页会自动重新检查。
          </p>
        </>
      )}
    </SubPage>
  );
}
