import { useMemo, useState, type CSSProperties } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Copy,
  Image as ImageIcon,
  LockKeyhole,
  Plus,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { Advance, Entry } from '../types';
import { useStore } from '../store';
import { AdvanceSheet } from '../components/AdvanceSheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { JobDot } from '../components/JobDot';
import { Money } from '../components/Money';
import { PayslipSheet } from '../components/PayslipSheet';
import { SubPage } from '../components/SubPage';
import {
  formatDateShort,
  formatDateWithWeekday,
  formatDateTime,
  periodOf,
  todayISO,
  weekdayCN,
} from '../lib/date';
import { formatHours, toAmount } from '../lib/money';
import { CYCLE_LABEL, jobColor } from '../lib/meta';
import { payForEntry } from '../lib/pay';
import {
  buildSettlementDraft,
  settlementCopyText,
} from '../lib/settlement';
import { copyText } from '../lib/clipboard';

interface DraftPageProps {
  jobId: string;
  periodStart: string;
  onBack: () => void;
  onSettled: (settlementId: string) => void;
}

function AmountRow({
  label,
  note,
  amount,
  strong = false,
  negative = false,
}: {
  label: string;
  note?: string;
  amount: number;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className={`amount-row ${strong ? 'is-strong' : ''}`}>
      <div>
        <span>{label}</span>
        {note ? <em>{note}</em> : null}
      </div>
      <Money value={negative ? -amount : amount} />
    </div>
  );
}

function SettleEntryRow({ entry }: { entry: Entry }) {
  const pay = payForEntry(entry);
  const isPiece = entry.rule.payType === 'piece';
  return (
    <div className="settle-entry-row">
      <span className="settle-entry-date">
        {formatDateShort(entry.date)}
        <em>{weekdayCN(entry.date)}</em>
      </span>
      <span className="settle-entry-meta">
        {isPiece
          ? `${formatHours(entry.quantity)} ${entry.rule.unitLabel || '件'}${
              entry.hours > 0 ? ` · ${formatHours(entry.hours)}h` : ''
            }`
          : `${formatHours(entry.hours)}h`}
        {pay.otHours > 0 ? ` · 加班 ${formatHours(pay.otHours)}h` : ''}
        {!isPiece && entry.endTime && entry.startTime && entry.endTime < entry.startTime
          ? ' · 次日'
          : ''}
        {entry.note ? ` · ${entry.note}` : ''}
      </span>
      <span className="settle-entry-amount">
        <Money value={pay.total} />
        {entry.rule.payType === 'monthly' ? <small>折算</small> : null}
        {isPiece ? <small>计件</small> : null}
      </span>
    </div>
  );
}

export function SettlementDraftPage({ jobId, periodStart, onBack, onSettled }: DraftPageProps) {
  const { state, settleJob, deleteAdvance, toast } = useStore();
  const [extraBonus, setExtraBonus] = useState('');
  const [extraDeduction, setExtraDeduction] = useState('');
  const [note, setNote] = useState('');
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [advanceToDelete, setAdvanceToDelete] = useState<string | null>(null);

  const job = state.jobs.find((item) => item.id === jobId);
  const period = periodOf(job?.cycle ?? 'weekly', periodStart, state.settings.weekStartsOn);
  const draft = useMemo(
    () =>
      job
        ? buildSettlementDraft(
            job,
            state.entries,
            state.advances,
            period,
            toAmount(extraBonus),
            toAmount(extraDeduction),
          )
        : null,
    [
      job,
      state.entries,
      state.advances,
      period.start,
      period.end,
      extraBonus,
      extraDeduction,
    ],
  );
  const today = todayISO();
  const defaultAdvanceDate = today <= period.end ? today : period.end;

  if (!job || !draft) {
    return (
      <SubPage title="核对结算" onBack={onBack}>
        <div className="card">
          <EmptyState
            icon={ClipboardList}
            title="找不到这份工作"
            description="它可能已经被删除。"
            actionLabel="返回"
            onAction={onBack}
            compact
          />
        </div>
      </SubPage>
    );
  }

  const meta = jobColor(job.color);
  const style = {
    '--slip-accent': meta.main,
    '--slip-soft': meta.soft,
  } as CSSProperties;
  const hasEntries = draft.entries.length > 0;

  const handleConfirm = () => {
    const settlement = settleJob(
      job.id,
      period,
      toAmount(extraBonus),
      toAmount(extraDeduction),
      note,
    );
    setConfirmOpen(false);
    if (!settlement) {
      toast('本期没有可结算的工记', 'error');
      return;
    }
    toast('结算完成，工记已锁定');
    onSettled(settlement.id);
  };

  const handleDeleteAdvance = () => {
    if (!advanceToDelete) return;
    const ok = deleteAdvance(advanceToDelete);
    setAdvanceToDelete(null);
    if (ok) toast('借支已删除', 'info');
    else toast('已结算的借支不能删除', 'error');
  };

  return (
    <>
      <SubPage
        title="核对结算"
        subtitle={job.name}
        onBack={onBack}
        footer={
          <div className="settle-footer">
            <div className="settle-footer-top">
              <div>
                <span>应发净额</span>
                <Money value={draft.net} className="settle-footer-amount" />
              </div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!hasEntries}
                onClick={() => setConfirmOpen(true)}
              >
                确认结算
              </button>
            </div>
            <p>
              {hasEntries
                ? '确认后工记与借支会锁定，可在结算历史里撤销。'
                : '本期没有工记，先补记一笔再结算。'}
            </p>
          </div>
        }
      >
        <section className="slip" style={style}>
          <div className="slip-top">
            <span className="slip-job">
              <JobDot color={job.color} size={9} ring />
              {job.name}
            </span>
            <span className="cycle-pill">{CYCLE_LABEL[job.cycle]}</span>
          </div>
          <p className="slip-period">{period.label}</p>
          <span className="slip-label">应发净额</span>
          <Money value={draft.net} className="slip-amount" />
          <div className="slip-stats">
            {draft.payType === 'piece' ? (
              <>
                <div>
                  <span>数量</span>
                  <strong>
                    {formatHours(draft.quantity)} {draft.unitLabel}
                  </strong>
                </div>
                <div>
                  <span>工时</span>
                  <strong>{formatHours(draft.hours)}h</strong>
                </div>
                <div>
                  <span>出勤</span>
                  <strong>{draft.days} 天</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>出勤</span>
                  <strong>{draft.days} 天</strong>
                </div>
                <div>
                  <span>工时</span>
                  <strong>{formatHours(draft.hours)}h</strong>
                </div>
                <div>
                  <span>加班</span>
                  <strong>{formatHours(draft.otHours)}h</strong>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="detail-card">
          <div className="detail-card-head">
            <h2>金额明细</h2>
            <span>{CYCLE_LABEL[job.cycle]}结算</span>
          </div>
          <div className="amount-list">
            <AmountRow
              label={draft.payType === 'piece' ? '计件工资' : '基础工资'}
              note={
                draft.payType === 'piece'
                  ? `${formatHours(draft.quantity)} ${draft.unitLabel} × 单价`
                  : job.rule.payType === 'monthly'
                    ? `${job.rule.expectedDays} 天折算`
                    : job.rule.payType === 'daily'
                      ? `${draft.days} 天出勤`
                      : '正常工时'
              }
              amount={draft.base}
            />
            {draft.otPay > 0 ? (
              <AmountRow label="加班工资" note={`${formatHours(draft.otHours)} 小时`} amount={draft.otPay} />
            ) : null}
            {draft.bonus > 0 ? <AmountRow label="工记奖金" amount={draft.bonus} /> : null}
            {draft.extraBonus > 0 ? <AmountRow label="额外奖金" amount={draft.extraBonus} /> : null}
            {draft.deduction > 0 ? (
              <AmountRow label="工记扣款" amount={draft.deduction} negative />
            ) : null}
            {draft.extraDeduction > 0 ? (
              <AmountRow label="额外扣款" amount={draft.extraDeduction} negative />
            ) : null}
            {draft.advanceTotal > 0 ? (
              <AmountRow label="借支抵扣" note="已经拿到的钱" amount={draft.advanceTotal} negative />
            ) : null}
            <div className="amount-divider" />
            <AmountRow label="应发净额" amount={draft.net} strong />
          </div>
          {draft.capAdjustment > 0 ? (
            <p className="calc-note">
              月薪已按整月封顶，已剔除 <Money value={draft.capAdjustment} />。
            </p>
          ) : null}
        </section>

        <section className="detail-card">
          <div className="detail-card-head">
            <h2>本期工记</h2>
            <span>{draft.entries.length} 笔</span>
          </div>
          {draft.entries.length > 0 ? (
            <div className="settle-entry-list">
              {draft.entries.map((entry) => (
                <SettleEntryRow entry={entry} key={entry.id} />
              ))}
            </div>
          ) : (
            <p className="empty-inline">本期没有工记。</p>
          )}
          {job.rule.payType === 'monthly' && draft.entries.length > 0 ? (
            <p className="calc-note">月薪明细为单日折算，结算已按整月封顶。</p>
          ) : null}
          {draft.payType === 'piece' && draft.entries.length > 0 ? (
            <p className="calc-note">计件明细按每条记录的数量 × 当时单价累计。</p>
          ) : null}
        </section>

        <section className="detail-card">
          <div className="detail-card-head">
            <h2>借支抵扣</h2>
            <button type="button" className="text-link" onClick={() => setAdvanceOpen(true)}>
              <Plus size={14} />
              补记借支
            </button>
          </div>
          {draft.advances.length > 0 ? (
            <div className="advance-list">
              {draft.advances.map((advance) => (
                <div className="advance-row" key={advance.id}>
                  <span className="advance-date">
                    <CalendarDays size={13} />
                    {formatDateShort(advance.date)}
                  </span>
                  <span className="advance-note">{advance.note || '借支'}</span>
                  <Money value={advance.amount} />
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => setAdvanceToDelete(advance.id)}
                    aria-label="删除借支"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-inline">本期没有借支。</p>
          )}
          <p className="calc-note">只抵扣日期在本期结束前的借支；日期更晚的留到下一期。</p>
        </section>

        <section className="detail-card">
          <div className="detail-card-head">
            <h2>额外奖扣</h2>
            <span>可选</span>
          </div>
          <div className="two-col">
            <label className="field">
              <span className="field-label">额外奖金</span>
              <div className="money-mini">
                <span>¥</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={extraBonus}
                  onChange={(event) => setExtraBonus(event.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">额外扣款</span>
              <div className="money-mini">
                <span>¥</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={extraDeduction}
                  onChange={(event) => setExtraDeduction(event.target.value)}
                  placeholder="0"
                  inputMode="decimal"
                />
              </div>
            </label>
          </div>
          <label className="field">
            <span className="field-label">结算备注</span>
            <input
              className="text-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：现金结清 / 微信转账（选填）"
              maxLength={60}
            />
          </label>
          <p className="field-hint">只调整本次结算，不会改动工记本身。</p>
        </section>
      </SubPage>

      {advanceOpen ? (
        <AdvanceSheet
          open
          jobId={job.id}
          defaultDate={defaultAdvanceDate}
          hint={`本期截止 ${formatDateShort(period.end)}，日期在此之前的借支会计入本期抵扣。`}
          onClose={() => setAdvanceOpen(false)}
          onAdded={(advance) => {
            if (advance.date > period.end) {
              toast('这笔借支在周期结束后，将在下一期抵扣', 'info');
            }
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title="确认结算这一期？"
        description={
          <span>
            应发净额 <b><Money value={draft.net} /></b>，共 {draft.entries.length} 笔工记。
            确认后工记与借支会锁定，可在结算历史里撤销。
          </span>
        }
        confirmLabel="确认结算"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      />

      <ConfirmDialog
        open={Boolean(advanceToDelete)}
        title="删除这笔借支？"
        description="删除后不会再从工钱里抵扣。"
        confirmLabel="删除"
        danger
        onCancel={() => setAdvanceToDelete(null)}
        onConfirm={handleDeleteAdvance}
      />
    </>
  );
}

interface RecordPageProps {
  settlementId: string;
  onBack: () => void;
}

export function SettlementRecordPage({ settlementId, onBack }: RecordPageProps) {
  const { state, undoSettlement, toast } = useStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payslipOpen, setPayslipOpen] = useState(false);
  const settlement = state.settlements.find((item) => item.id === settlementId);
  if (!settlement) {
    return (
      <SubPage title="结算单" onBack={onBack}>
        <div className="card">
          <EmptyState
            icon={ClipboardList}
            title="结算单不见了"
            description="它可能已经被撤销。"
            actionLabel="返回"
            onAction={onBack}
            compact
          />
        </div>
      </SubPage>
    );
  }
  const job = state.jobs.find((item) => item.id === settlement.jobId);
  const meta = jobColor(job?.color ?? 'pine');
  const style = {
    '--slip-accent': meta.main,
    '--slip-soft': meta.soft,
  } as CSSProperties;
  const entries = settlement.entryIds
    .map((id) => state.entries.find((entry) => entry.id === id))
    .filter((entry): entry is Entry => Boolean(entry));
  const advances = settlement.advanceIds
    .map((id) => state.advances.find((advance) => advance.id === id))
    .filter((advance): advance is Advance => Boolean(advance));

  const handleCopy = async () => {
    const ok = await copyText(settlementCopyText(settlement));
    toast(ok ? '结算单已复制，可直接发给老板' : '复制失败，请手动截图', ok ? 'success' : 'error');
  };

  const handleUndo = () => {
    const ok = undoSettlement(settlement.id);
    setConfirmOpen(false);
    if (ok) {
      toast('已撤销结算，工记已解锁', 'info');
      onBack();
    } else {
      toast('撤销失败，请重试', 'error');
    }
  };

  return (
    <>
      <SubPage
        title="结算单"
        subtitle={settlement.jobName}
        onBack={onBack}
        action={
          <span className="status-chip status-chip--settled">
            <LockKeyhole size={12} />
            已结算
          </span>
        }
        footer={
          <div className="record-footer">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setPayslipOpen(true)}
            >
              <ImageIcon size={16} />
              工资条
            </button>
            <button type="button" className="btn btn--soft" onClick={handleCopy}>
              <Copy size={16} />
              复制
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--danger-text"
              onClick={() => setConfirmOpen(true)}
            >
              <Undo2 size={16} />
              撤销
            </button>
          </div>
        }
      >
        <section className="slip slip--done" style={style}>
          <div className="slip-top">
            <span className="slip-job">
              <JobDot color={job?.color ?? 'pine'} size={9} ring />
              {settlement.jobName}
            </span>
            <span className="cycle-pill">{CYCLE_LABEL[settlement.cycle]}</span>
          </div>
          <p className="slip-period">
            {formatDateWithWeekday(settlement.periodStart)} –{' '}
            {formatDateWithWeekday(settlement.periodEnd)}
          </p>
          <span className="slip-label">应发净额</span>
          <Money value={settlement.net} className="slip-amount" />
          <div className="slip-done-line">
            <CheckCircle2 size={14} />
            结算于 {formatDateTime(settlement.createdAt)}
          </div>
          <div className="slip-stats">
            {settlement.payType === 'piece' ? (
              <>
                <div>
                  <span>数量</span>
                  <strong>
                    {formatHours(settlement.quantity ?? 0)} {settlement.unitLabel || '件'}
                  </strong>
                </div>
                <div>
                  <span>工时</span>
                  <strong>{formatHours(settlement.hours)}h</strong>
                </div>
                <div>
                  <span>出勤</span>
                  <strong>{settlement.days} 天</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>出勤</span>
                  <strong>{settlement.days} 天</strong>
                </div>
                <div>
                  <span>工时</span>
                  <strong>{formatHours(settlement.hours)}h</strong>
                </div>
                <div>
                  <span>加班</span>
                  <strong>{formatHours(settlement.otHours)}h</strong>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="detail-card">
          <div className="detail-card-head">
            <h2>金额明细</h2>
            <span>{CYCLE_LABEL[settlement.cycle]}已结</span>
          </div>
          <div className="amount-list">
            <AmountRow
              label={settlement.payType === 'piece' ? '计件工资' : '基础工资'}
              amount={settlement.base}
            />
            {settlement.otPay > 0 ? <AmountRow label="加班工资" amount={settlement.otPay} /> : null}
            {settlement.bonus > 0 ? <AmountRow label="工记奖金" amount={settlement.bonus} /> : null}
            {settlement.extraBonus > 0 ? (
              <AmountRow label="额外奖金" amount={settlement.extraBonus} />
            ) : null}
            {settlement.deduction > 0 ? (
              <AmountRow label="工记扣款" amount={settlement.deduction} negative />
            ) : null}
            {settlement.extraDeduction > 0 ? (
              <AmountRow label="额外扣款" amount={settlement.extraDeduction} negative />
            ) : null}
            {settlement.advanceTotal > 0 ? (
              <AmountRow label="借支抵扣" amount={settlement.advanceTotal} negative />
            ) : null}
            <div className="amount-divider" />
            <AmountRow label="应发净额" amount={settlement.net} strong />
          </div>
          {settlement.note ? <p className="calc-note">备注：{settlement.note}</p> : null}
        </section>

        {entries.length > 0 ? (
          <section className="detail-card">
            <div className="detail-card-head">
              <h2>本期工记</h2>
              <span>{entries.length} 笔</span>
            </div>
            <div className="settle-entry-list">
              {entries.map((entry) => (
                <SettleEntryRow entry={entry} key={entry.id} />
              ))}
            </div>
            {entries.some((entry) => entry.rule.payType === 'monthly') ? (
              <p className="calc-note">月薪明细为单日折算，结算已按整月封顶。</p>
            ) : null}
          </section>
        ) : null}

        {advances.length > 0 ? (
          <section className="detail-card">
            <div className="detail-card-head">
              <h2>借支抵扣</h2>
              <span>{advances.length} 笔</span>
            </div>
            <div className="advance-list">
              {advances.map((advance) => (
                <div className="advance-row" key={advance.id}>
                  <span className="advance-date">
                    <CalendarDays size={13} />
                    {formatDateShort(advance.date)}
                  </span>
                  <span className="advance-note">{advance.note || '借支'}</span>
                  <Money value={advance.amount} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <p className="record-tip">
          这张结算单是当时的快照。复制后可发给老板对账；撤销结算会让工记重新进入待结算。
        </p>
      </SubPage>

      <ConfirmDialog
        open={confirmOpen}
        title="撤销这张结算单？"
        description="撤销后，本期工记和借支会重新进入待结算，金额可能随记录变化。"
        confirmLabel="撤销结算"
        danger
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleUndo}
      />

      {payslipOpen ? (
        <PayslipSheet
          settlement={settlement}
          accent={meta.main}
          onClose={() => setPayslipOpen(false)}
        />
      ) : null}
    </>
  );
}
