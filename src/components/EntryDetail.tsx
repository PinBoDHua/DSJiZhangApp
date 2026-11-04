import { useState } from 'react';
import { LockKeyhole, Pencil, Trash2 } from 'lucide-react';
import type { Entry, Job } from '../types';
import { useStore } from '../store';
import { formatDateTime, formatDateFull, formatTimeRange } from '../lib/date';
import { formatHours } from '../lib/money';
import { payForEntry } from '../lib/pay';
import { Sheet } from './Sheet';
import { Money } from './Money';
import { JobDot } from './JobDot';
import { ConfirmDialog } from './ConfirmDialog';

interface EntryDetailProps {
  entryId: string;
  onClose: () => void;
  onEdit: (entryId: string) => void;
}

export function EntryDetail({ entryId, onClose, onEdit }: EntryDetailProps) {
  const { state, deleteEntry, toast } = useStore();
  const [confirming, setConfirming] = useState(false);
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return null;
  const job: Job | undefined = state.jobs.find((item) => item.id === entry.jobId);
  const pay = payForEntry(entry);
  const settled = Boolean(entry.settlementId);
  const baseHours = Math.max(0, entry.hours - pay.otHours);
  const overnight = Boolean(
    entry.startTime && entry.endTime && entry.endTime < entry.startTime,
  );

  const handleDelete = () => {
    const ok = deleteEntry(entry.id);
    setConfirming(false);
    if (ok) {
      toast('工记已删除', 'info');
      onClose();
    } else {
      toast('已结算的记录不能删除，请先撤销结算', 'error');
    }
  };

  const formula = () => {
    if (entry.rule.payType === 'hourly') {
      return (
        <>
          {formatHours(baseHours)}h × <Money value={entry.rule.rate} />
        </>
      );
    }
    if (entry.rule.payType === 'daily') {
      return (
        <>
          日薪 <Money value={entry.rule.rate} />
        </>
      );
    }
    return (
      <>
        月薪 <Money value={entry.rule.rate} /> ÷ {entry.rule.expectedDays} 天
      </>
    );
  };

  return (
    <>
      <Sheet open title="工记详情" onClose={onClose}>
        <div className="sheet-body detail-body">
          <div className="detail-hero">
            <div className="detail-hero-top">
              <span className="detail-job">
                <JobDot color={job?.color ?? 'pine'} size={9} ring />
                {job?.name ?? '未知工作'}
              </span>
              {settled ? (
                <span className="status-chip status-chip--settled">
                  <LockKeyhole size={12} />
                  已结算
                </span>
              ) : (
                <span className="status-chip">待结算</span>
              )}
            </div>
            <p className="detail-date">{formatDateFull(entry.date)}</p>
            <div className="detail-total">
              <span>本笔工资</span>
              <Money value={pay.total} className="detail-amount" />
            </div>
            <div className="detail-tags">
              {entry.startTime && entry.endTime ? (
                <span>{formatTimeRange(entry.startTime, entry.endTime)}</span>
              ) : null}
              {overnight ? <span>跨天</span> : null}
              <span>{formatHours(entry.hours)} 小时</span>
              {pay.otHours > 0 ? <span className="is-ot">加班 {formatHours(pay.otHours)}h</span> : null}
              {entry.holiday ? <span className="is-holiday">法定节假日</span> : null}
            </div>
          </div>

          <section className="detail-section">
            <h3>怎么算的</h3>
            <div className="calc-card">
              <div className="calc-row">
                <span>
                  {entry.rule.payType === 'monthly' ? '月薪折算' : '基础工资'}
                </span>
                <em>{formula()}</em>
                <strong>
                  <Money value={pay.base} />
                </strong>
              </div>
              {pay.otHours > 0 ? (
                <div className="calc-row">
                  <span>加班工资</span>
                  <em>
                    {formatHours(pay.otHours)}h × {pay.multiplier} ×{' '}
                    <Money value={pay.otRate} />
                  </em>
                  <strong>
                    <Money value={pay.otPay} />
                  </strong>
                </div>
              ) : null}
              {pay.bonus > 0 ? (
                <div className="calc-row">
                  <span>奖金</span>
                  <em>额外补贴</em>
                  <strong>
                    <Money value={pay.bonus} signed />
                  </strong>
                </div>
              ) : null}
              {pay.deduction > 0 ? (
                <div className="calc-row">
                  <span>扣款</span>
                  <em>本期扣除</em>
                  <strong className="is-negative">
                    −<Money value={pay.deduction} />
                  </strong>
                </div>
              ) : null}
              <div className="calc-row calc-row--total">
                <span>合计</span>
                <em>{entry.rule.payType === 'monthly' ? '月薪于结算时封顶' : '本笔预计'}</em>
                <strong>
                  <Money value={pay.total} />
                </strong>
              </div>
            </div>
          </section>

          {entry.note ? (
            <section className="detail-section">
              <h3>备注</h3>
              <p className="detail-note">{entry.note}</p>
            </section>
          ) : null}

          <section className="detail-section">
            <h3>记录信息</h3>
            <div className="meta-list">
              <div>
                <span>单价</span>
                <b>
                  <Money value={entry.rule.rate} /> /{' '}
                  {entry.rule.payType === 'hourly' ? '时' : entry.rule.payType === 'daily' ? '天' : '月'}
                </b>
              </div>
              <div>
                <span>标准工时</span>
                <b>{entry.rule.standardHours} 小时 / 天</b>
              </div>
              {entry.breakMinutes > 0 ? (
                <div>
                  <span>休息</span>
                  <b>{entry.breakMinutes} 分钟</b>
                </div>
              ) : null}
              <div>
                <span>记录于</span>
                <b>{formatDateTime(entry.createdAt)}</b>
              </div>
            </div>
          </section>

          {settled ? (
            <div className="locked-note">
              <LockKeyhole size={15} />
              这笔工记已结算。如需修改，请先在「结算」里撤销对应结算单。
            </div>
          ) : (
            <div className="detail-actions">
              <button type="button" className="btn btn--soft" onClick={() => onEdit(entry.id)}>
                <Pencil size={16} />
                编辑
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--danger-text"
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={16} />
                删除
              </button>
            </div>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirming}
        title="删除这笔工记？"
        description="删除后无法恢复，也不会计入之后的结算。"
        confirmLabel="删除"
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
