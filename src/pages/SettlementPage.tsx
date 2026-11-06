import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Coffee,
  Copy,
  Image as ImageIcon,
  LockKeyhole,
  Plus,
  QrCode,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { Advance, Entry } from '../types';
import { useStore } from '../store';
import { AdvanceSheet } from '../components/AdvanceSheet';
import { AttendanceDaySheet } from '../components/AttendanceDaySheet';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { JobDot } from '../components/JobDot';
import { Money } from '../components/Money';
import { PayslipSheet } from '../components/PayslipSheet';
import { PaymentSheet } from '../components/PaymentSheet';
import { ShareQrSheet } from '../components/ShareQrSheet';
import { SubPage } from '../components/SubPage';
import {
  eachDay,
  formatDateShort,
  formatDateWithWeekday,
  formatDateTime,
  periodContains,
  periodOf,
  todayISO,
  weekdayCN,
} from '../lib/date';
import { formatHours, toAmount } from '../lib/money';
import { findSettlementOverlap } from '../lib/guards';
import { formatRestDays, restDayAmount } from '../lib/rest';
import { CYCLE_LABEL, jobColor } from '../lib/meta';
import { payForEntry } from '../lib/pay';
import {
  buildSettlementDraft,
  settlementCopyText,
} from '../lib/settlement';
import { copyText } from '../lib/clipboard';
import { saveSnapshot } from '../lib/snapshots';
import { pushNativeBack } from '../lib/nativeBack';
import {
  PAYMENT_STATUS_LABEL,
  paidAmountOf,
  paymentStatusOf,
  remainingAmountOf,
} from '../lib/payment';

interface DraftPageProps {
  jobId: string;
  periodStart: string;
  onBack: () => void;
  onSettled: (settlementId: string) => void;
  onAddEntry: (jobId: string, date: string) => void;
  onOpenEntry: (entryId: string) => void;
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

const WEEKDAYS_MONDAY = ['一', '二', '三', '四', '五', '六', '日'];
const WEEKDAYS_SUNDAY = ['日', '一', '二', '三', '四', '五', '六'];

function weekdayOffset(date: string, weekStartsOn: 0 | 1): number {
  const day = new Date(`${date}T00:00:00`).getDay();
  return weekStartsOn === 1 ? (day + 6) % 7 : day;
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

export function SettlementDraftPage({
  jobId,
  periodStart,
  onBack,
  onSettled,
  onAddEntry,
  onOpenEntry,
}: DraftPageProps) {
  const { state, settleJob, deleteAdvance, restoreAdvance, toast } = useStore();
  const [extraBonus, setExtraBonus] = useState('');
  const [extraDeduction, setExtraDeduction] = useState('');
  const [note, setNote] = useState('');
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [advanceToDelete, setAdvanceToDelete] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [overRestEnabled, setOverRestEnabled] = useState(
    state.jobs.find((item) => item.id === jobId)?.rule.overRestDeduct ?? false,
  );
  const [overRestAmount, setOverRestAmount] = useState('');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    const policyEnabled =
      state.jobs.find((item) => item.id === jobId)?.rule.overRestDeduct ?? false;
    dirtyRef.current =
      extraBonus.trim() !== '' ||
      extraDeduction.trim() !== '' ||
      note.trim() !== '' ||
      overRestAmount.trim() !== '' ||
      overRestEnabled !== policyEnabled;
  }, [
    extraBonus,
    extraDeduction,
    note,
    overRestAmount,
    overRestEnabled,
    jobId,
    state.jobs,
  ]);

  const requestBack = () => {
    if (dirtyRef.current) {
      setDiscardOpen(true);
      return;
    }
    onBack();
  };

  const requestBackRef = useRef(requestBack);
  requestBackRef.current = requestBack;

  useEffect(() => pushNativeBack(() => requestBackRef.current()), []);

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
            state.restDays,
            overRestEnabled,
            overRestAmount.trim() === '' ? undefined : toAmount(overRestAmount),
          )
        : null,
    [
      job,
      state.entries,
      state.advances,
      state.restDays,
      period.start,
      period.end,
      extraBonus,
      extraDeduction,
      overRestEnabled,
      overRestAmount,
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
  const isFixedDraft = draft.payType === 'monthly' && draft.monthlyMode === 'fixed';
  const isFlexibleRest =
    isFixedDraft && (job.rule.restPolicy ?? 'quota') === 'flexible';
  const isMonthlyDraft = draft.payType === 'monthly';
  const monthRestDays = state.restDays
    .filter((rest) => rest.jobId === job.id && periodContains(period, rest.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const monthRestByDate = new Map(monthRestDays.map((rest) => [rest.date, rest]));
  const monthEntryDates = new Set(draft.entries.map((entry) => entry.date));
  const monthDays = isMonthlyDraft ? eachDay(period.start, period.end) : [];
  const monthOffset = isMonthlyDraft
    ? weekdayOffset(period.start, state.settings.weekStartsOn)
    : 0;
  const monthWeekdays =
    state.settings.weekStartsOn === 1 ? WEEKDAYS_MONDAY : WEEKDAYS_SUNDAY;

  const handleMonthDayClick = (date: string) => {
    setSelectedDay(date);
  };

  const handleConfirm = () => {
    if (findSettlementOverlap(state.settlements, job.id, period)) {
      setConfirmOpen(false);
      toast('这个周期已经结算过了，请先撤销原结算', 'error');
      return;
    }
    const settlement = settleJob(
      job.id,
      period,
      toAmount(extraBonus),
      toAmount(extraDeduction),
      note,
      overRestEnabled,
      overRestAmount.trim() === '' ? undefined : toAmount(overRestAmount),
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
    const deleted = state.advances.find((advance) => advance.id === advanceToDelete);
    const ok = deleteAdvance(advanceToDelete);
    setAdvanceToDelete(null);
    if (!ok || !deleted) {
      toast('已结算的借支不能删除', 'error');
      return;
    }
    toast('借支已删除', 'info', {
      label: '撤销',
      onClick: () => {
        if (restoreAdvance(deleted)) toast('借支已恢复');
        else toast('这笔借支已无法恢复，请检查周期是否已结算', 'error');
      },
    });
  };

  return (
    <>
      <SubPage
        title="核对结算"
        subtitle={job.name}
        onBack={requestBack}
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
            ) : draft.payType === 'monthly' ? (
              <>
                <div>
                  <span>出勤</span>
                  <strong>{draft.days} 天</strong>
                </div>
                <div>
                  <span>休息</span>
                  <strong>{draft.restDays} 天</strong>
                </div>
                <div>
                  <span>工时</span>
                  <strong>{formatHours(draft.hours)}h</strong>
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

        {isMonthlyDraft ? (
          <section className="detail-card rest-month-card">
            <div className="detail-card-head">
              <div>
                <h2>本月出勤 / 休息</h2>
                <p className="overrest-meta">
                  出勤 {draft.days} 天 · 休息 {draft.restDays} 天
                  {isFixedDraft && !isFlexibleRest && job.rule.restDaysPerMonth > 0
                    ? ` · 额度 ${job.rule.restDaysPerMonth} 天`
                    : isFlexibleRest
                      ? ' · 随机休息'
                      : ''}
                </p>
              </div>
              <span className="rest-month-hint">点日期补记工 / 标休息</span>
            </div>
            <div className="rest-month-weekdays">
              {monthWeekdays.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="rest-month-grid">
              {Array.from({ length: monthOffset }).map((_, index) => (
                <span key={`blank-${index}`} />
              ))}
              {monthDays.map((date) => {
                const rest = monthRestByDate.get(date);
                const worked = monthEntryDates.has(date);
                return (
                  <button
                    type="button"
                    key={date}
                    data-date={date}
                    className={[
                      'rest-month-day',
                      worked ? 'is-worked' : rest ? 'is-rest' : 'is-empty',
                      date === today ? 'is-today' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => handleMonthDayClick(date)}
                    aria-label={`${formatDateShort(date)}${
                      worked
                        ? '已记工'
                        : rest
                          ? `休息 ${formatRestDays(restDayAmount(rest))} 天`
                          : '未记，点一下补记工或标休息'
                    }`}
                  >
                    <span>{Number(date.slice(8))}</span>
                    {worked ? (
                      <b>班</b>
                    ) : rest ? (
                      restDayAmount(rest) === 0.5 ? (
                        <b>½</b>
                      ) : (
                        <Coffee size={9} />
                      )
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="rest-month-legend">
              <span>
                <i className="legend-worked" />
                已记工
              </span>
              <span>
                <i className="legend-rest" />
                休息
              </span>
              <span>
                <i className="legend-empty" />
                未记
              </span>
            </div>
            {isFixedDraft && !isFlexibleRest && draft.overRestDays > 0 ? (
              <p className="rest-month-warning">
                已超月休额度 {draft.overRestDays} 天
                {job.rule.overRestDeduct
                  ? '，本期会按超休规则扣款'
                  : '；当前规则不自动扣款'}
              </p>
            ) : null}
            <p className="field-hint">
              {isFixedDraft
                ? '点日期可以补记工或标休息；休息日会写进本期结算和工资条。'
                : '按出勤折算的休息日不计薪，只做统计；如果休息不扣钱，请在工作设置里改用「固定月薪 + 随机休息」。'}
            </p>
          </section>
        ) : null}

        <section className="detail-card">
          <div className="detail-card-head">
            <h2>金额明细</h2>
            <span>{CYCLE_LABEL[job.cycle]}结算</span>
          </div>
          <div className="amount-list">
            <AmountRow
              label={
                draft.payType === 'piece'
                  ? '计件工资'
                  : draft.payType === 'monthly' && draft.monthlyMode === 'fixed'
                    ? '固定月薪'
                    : '基础工资'
              }
              note={
                draft.payType === 'piece'
                  ? `${formatHours(draft.quantity)} ${draft.unitLabel} × 单价`
                  : draft.payType === 'monthly' && draft.monthlyMode === 'fixed'
                    ? `出勤 ${draft.days} 天 · ${
                        isFlexibleRest ? '随机休息' : '月休'
                      } ${draft.restDays} 天`
                    : job.rule.payType === 'monthly'
                      ? `${job.rule.expectedDays} 天折算 · 休息 ${draft.restDays} 天`
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
            {draft.overRestDeduction > 0 ? (
              <AmountRow
                label="超休扣款"
                note={`超休 ${draft.overRestDays} 天`}
                amount={draft.overRestDeduction}
                negative
              />
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
            <p className="calc-note">
              {draft.monthlyMode === 'fixed'
                ? `固定月薪整月发放；上方单笔为日折算参考，实际不按出勤天数扣减。本期休息 ${
                    draft.restDays
                  } 天${
                    draft.restDates.length > 0
                      ? `（${draft.restDates.map(formatDateShort).join('、')}）`
                      : ''
                  }。`
                : `月薪明细为单日折算，结算已按整月封顶；休息日不计薪。本期休息 ${
                    draft.restDays
                  } 天。`}
            </p>
          ) : null}
          {draft.payType === 'piece' && draft.entries.length > 0 ? (
            <p className="calc-note">计件明细按每条记录的数量 × 当时单价累计。</p>
          ) : null}
        </section>

        {isFixedDraft && !isFlexibleRest && job.rule.overRestDeduct ? (
          <section className="detail-card overrest-card">
            <div className="detail-card-head">
              <div>
                <h2>超休扣款</h2>
                <p className="overrest-meta">
                  本月休息 {draft.restDays} 天 · 额度 {job.rule.restDaysPerMonth} 天
                  {draft.overRestDays > 0 ? ` · 超休 ${draft.overRestDays} 天` : ' · 未超休'}
                </p>
              </div>
              <button
                type="button"
                className={`switch ${overRestEnabled ? 'is-on' : ''}`}
                role="switch"
                aria-checked={overRestEnabled}
                aria-label="本期扣超休"
                onClick={() => setOverRestEnabled((value) => !value)}
              >
                <i />
              </button>
            </div>
            {overRestEnabled && draft.overRestDays > 0 ? (
              <label className="field overrest-field">
                <span className="field-label">本期扣款金额</span>
                <div className="inline-number">
                  <span>¥</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={overRestAmount}
                    onChange={(event) => setOverRestAmount(event.target.value)}
                    placeholder={String(
                      Math.round(
                        (job.rule.overRestDailyRate > 0
                          ? job.rule.overRestDailyRate
                          : job.rule.rate / Math.max(1, job.rule.expectedDays)) *
                          draft.overRestDays *
                          100,
                      ) / 100,
                    )}
                    inputMode="decimal"
                  />
                  <span>元</span>
                </div>
                <p className="field-hint">
                  留空 = 按 {draft.overRestDays} 天自动计算；这次结算可以单独关掉或改金额。
                </p>
              </label>
            ) : (
              <p className="field-hint">
                {draft.overRestDays > 0
                  ? '本期不扣超休工资；确认结算前都可以再打开。'
                  : '休息没有超过额度，本期不产生超休扣款。'}
              </p>
            )}
          </section>
        ) : null}

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
        open={discardOpen}
        title="放弃这次奖扣？"
        description="额外奖金、扣款、超休设置和备注还没有结算，返回后这些输入会丢失。"
        confirmLabel="放弃"
        danger
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          dirtyRef.current = false;
          onBack();
        }}
      />

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

      <AttendanceDaySheet
        open={Boolean(selectedDay)}
        job={job}
        date={selectedDay}
        entries={
          selectedDay
            ? draft.entries.filter((entry) => entry.date === selectedDay)
            : []
        }
        rest={selectedDay ? monthRestByDate.get(selectedDay) : undefined}
        settled={false}
        onClose={() => setSelectedDay(null)}
        onAddEntry={onAddEntry}
        onOpenEntry={onOpenEntry}
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
  const [qrOpen, setQrOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
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
  const paymentStatus = paymentStatusOf(settlement);
  const paidAmount = paidAmountOf(settlement);
  const remainingAmount = remainingAmountOf(settlement);

  const handleCopy = async () => {
    const ok = await copyText(settlementCopyText(settlement));
    toast(ok ? '结算单已复制，可直接发给老板' : '复制失败，请手动截图', ok ? 'success' : 'error');
  };

  const handleUndo = () => {
    void saveSnapshot(state, 'before-undo-settlement').catch(() => undefined);
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
            <button type="button" className="btn btn--soft" onClick={() => setQrOpen(true)}>
              <QrCode size={16} />
              二维码
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
            ) : settlement.payType === 'monthly' ? (
              <>
                <div>
                  <span>出勤</span>
                  <strong>{settlement.days} 天</strong>
                </div>
                <div>
                  <span>休息</span>
                  <strong>{settlement.restDays ?? 0} 天</strong>
                </div>
                <div>
                  <span>工时</span>
                  <strong>{formatHours(settlement.hours)}h</strong>
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
              label={
                settlement.payType === 'piece'
                  ? '计件工资'
                  : settlement.payType === 'monthly' && settlement.monthlyMode === 'fixed'
                    ? '固定月薪'
                    : '基础工资'
              }
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
            {settlement.overRestDeduction && settlement.overRestDeduction > 0 ? (
              <AmountRow
                label="超休扣款"
                note={`超休 ${settlement.overRestDays ?? 0} 天`}
                amount={settlement.overRestDeduction}
                negative
              />
            ) : null}
            {settlement.advanceTotal > 0 ? (
              <AmountRow label="借支抵扣" amount={settlement.advanceTotal} negative />
            ) : null}
            <div className="amount-divider" />
            <AmountRow label="应发净额" amount={settlement.net} strong />
          </div>
          {settlement.note ? <p className="calc-note">备注：{settlement.note}</p> : null}
        </section>

        <section className="detail-card payment-card">
          <div className="detail-card-head">
            <div>
              <h2>收款</h2>
              <p className="overrest-meta">
                已收 <Money value={paidAmount} /> · 还剩 <Money value={remainingAmount} />
              </p>
            </div>
            <span className={`pay-status pay-status--${paymentStatus}`}>
              {PAYMENT_STATUS_LABEL[paymentStatus]}
            </span>
          </div>
          <div className="payment-track" aria-hidden="true">
            <span
              style={{
                width: `${settlement.net > 0 ? Math.min(100, (paidAmount / settlement.net) * 100) : 0}%`,
              }}
            />
          </div>
          <div className="payment-row">
            <span>
              {settlement.paidAt
                ? `${settlement.paidAt} · ${settlement.paymentMethod || '收款'}`
                : '还没有登记收款'}
            </span>
            <button
              type="button"
              className="btn btn--soft btn--sm"
              onClick={() => setPaymentOpen(true)}
            >
              {paidAmount > 0 ? '修改收款' : '登记收款'}
            </button>
          </div>
          {settlement.paymentNote ? (
            <p className="calc-note">收款备注：{settlement.paymentNote}</p>
          ) : null}
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
              <p className="calc-note">
                {settlement.payType === 'monthly' && settlement.monthlyMode === 'fixed'
                  ? `固定月薪整月发放；上方单笔为日折算参考。本期休息 ${
                      settlement.restDays ?? 0
                    } 天。`
                  : '月薪明细为单日折算，结算已按整月封顶；休息日不计薪。'}
              </p>
            ) : null}
          </section>
        ) : null}

        {settlement.payType === 'monthly' && (settlement.restDays ?? 0) > 0 ? (
          <section className="detail-card">
            <div className="detail-card-head">
              <h2>本期休息</h2>
              <span>{settlement.restDays ?? 0} 天</span>
            </div>
            {(settlement.restDates ?? []).length > 0 ? (
              <div className="rest-date-list">
                {(settlement.restDates ?? []).map((date) => (
                  <span className="rest-date-chip" key={date}>
                    {formatDateShort(date)}
                    <em>{weekdayCN(date)}</em>
                  </span>
                ))}
              </div>
            ) : (
              <p className="empty-inline">
                这张结算单生成于旧版本，只记录了休息天数，没有保存具体日期。
              </p>
            )}
            <p className="calc-note">
              休息日期按结算时的快照保留，之后修改休息记录不会改动这张结算单。
            </p>
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

      {qrOpen ? (
        <ShareQrSheet settlement={settlement} onClose={() => setQrOpen(false)} />
      ) : null}

      {payslipOpen ? (
        <PayslipSheet
          settlement={settlement}
          accent={meta.main}
          onClose={() => setPayslipOpen(false)}
        />
      ) : null}

      <PaymentSheet
        open={paymentOpen}
        settlement={settlement}
        onClose={() => setPaymentOpen(false)}
      />
    </>
  );
}
