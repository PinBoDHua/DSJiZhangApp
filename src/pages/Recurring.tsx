import { useMemo, useState, type FormEvent } from 'react';
import { CalendarClock, Pencil, Play, Plus, Repeat2, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { Segmented } from '../components/Segmented';
import { Sheet } from '../components/Sheet';
import { SubPage } from '../components/SubPage';
import { useStore } from '../store';
import type { RecurringFrequency, RecurringRule } from '../types';
import { formatDateShort, todayISO } from '../lib/date';
import { formatHours, toAmount } from '../lib/money';
import { plannedEntryHours } from '../lib/planEntries';
import {
  materializeRecurring,
  nextRecurringDate,
  recurringRuleLabel,
  type NewRecurringRuleInput,
} from '../lib/recurring';

const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 0, label: '日' },
];

export function Recurring({ onBack }: { onBack: () => void }) {
  const {
    state,
    addRecurringRule,
    updateRecurringRule,
    deleteRecurringRule,
    generateRecurring,
    toast,
  } = useStore();
  const today = todayISO();
  const [editorId, setEditorId] = useState<string | 'new' | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const rules = useMemo(
    () => state.recurringRules ?? [],
    [state.recurringRules],
  );
  const preview = useMemo(
    () => materializeRecurring(state, { today, createId: () => 'preview-recurring' }),
    [state, today],
  );
  const sourceIds = useMemo(() => new Set(state.entries.map((entry) => entry.id)), [state.entries]);
  const pendingEntries = useMemo(
    () => preview.state.entries.filter((entry) => !sourceIds.has(entry.id)),
    [preview.state.entries, sourceIds],
  );
  const editing = editorId && editorId !== 'new'
    ? rules.find((rule) => rule.id === editorId)
    : undefined;

  const generate = () => {
    const result = generateRecurring({ today });
    const extra = result.truncated ? '；更早的规则日超出 120 天回溯上限，未补记' : '';
    if (result.added > 0) {
      toast(`已补记 ${result.added} 笔${result.skipped > 0 ? `，跳过 ${result.skipped} 天` : ''}${extra}`);
    } else {
      toast(`没有可新增的工记；冲突日期已标记为处理过${extra}`, 'info');
    }
  };

  return (
    <SubPage
      title="周期记工"
      subtitle="固定班次做成规则，到期核对后补记"
      onBack={onBack}
      action={
        <button
          type="button"
          className="icon-button"
          onClick={() => setEditorId('new')}
          aria-label="新建周期规则"
          disabled={state.jobs.filter((job) => !job.archived).length === 0}
        >
          <Plus size={20} />
        </button>
      }
    >
      <section className="recurring-summary">
        <div className="recurring-summary-head">
          <span className="recurring-summary-icon"><Repeat2 size={22} /></span>
          <div>
            <strong>{pendingEntries.length} 笔待补记</strong>
            <p>只核对到昨天；已记、休息、已结算和超 24h 会跳过</p>
          </div>
        </div>
        {pendingEntries.length > 0 ? (
          <div className="recurring-preview-dates">
            {pendingEntries
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 8)
              .map((entry) => <span key={`${entry.recurringRuleId}-${entry.date}`}>{formatDateShort(entry.date)}</span>)}
            {pendingEntries.length > 8 ? <em>等 {pendingEntries.length} 天</em> : null}
          </div>
        ) : null}
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={generate}
          disabled={preview.added + preview.skipped === 0}
        >
          <Play size={16} />
          确认补记到期工记
        </button>
        {preview.skipped > 0 ? <p className="field-hint">另有 {preview.skipped} 天因已有记录或规则冲突而跳过。</p> : null}
        {preview.truncated ? (
          <p className="field-hint">
            规则开始日期早于 120 天前，只补记最近 120 天；更早的日期不会自动生成。
          </p>
        ) : null}
      </section>

      <div className="section-head recurring-list-head">
        <div><h2>我的规则</h2><p>{rules.length} 条 · 删除规则不影响已生成的工记</p></div>
      </div>
      {rules.length === 0 ? (
        <div className="card empty-card">
          <EmptyState
            icon={CalendarClock}
            title="还没有周期规则"
            description="适合每天固定班次、每周固定工作日或每月固定出勤。"
            actionLabel="新建规则"
            onAction={() => setEditorId('new')}
          />
        </div>
      ) : (
        <div className="recurring-list">
          {rules.map((rule) => {
            const job = state.jobs.find((item) => item.id === rule.jobId);
            const next = nextRecurringDate(rule, today);
            return (
              <article className={`card recurring-rule ${rule.enabled ? '' : 'is-disabled'}`} key={rule.id}>
                <div className="recurring-rule-head">
                  <div>
                    <h3>{job?.name ?? '工作已删除'}</h3>
                    <p>{recurringRuleLabel(rule)}</p>
                  </div>
                  <button
                    type="button"
                    className={`switch ${rule.enabled ? 'is-on' : ''}`}
                    role="switch"
                    aria-checked={rule.enabled}
                    aria-label={`${job?.name ?? '规则'}启用状态`}
                    onClick={() => {
                      const ok = updateRecurringRule({ ...rule, enabled: !rule.enabled });
                      if (!ok) toast('规则状态保存失败，请检查工作是否已归档', 'error');
                    }}
                  ><i /></button>
                </div>
                <div className="recurring-rule-meta">
                  <span>{formatHours(rule.hours)}h{rule.quantity > 0 ? ` · ${formatHours(rule.quantity)} 件` : ''}</span>
                  <span>{rule.auto ? '自动补到昨天' : '仅手动确认'}</span>
                </div>
                <p className="recurring-rule-next">
                  {next ? `下次规则日：${next}` : '规则已结束'}
                  {rule.lastProcessedDate ? ` · 已处理到 ${rule.lastProcessedDate}` : ''}
                </p>
                <div className="recurring-rule-actions">
                  <button type="button" className="btn btn--soft btn--sm" onClick={() => setEditorId(rule.id)}>
                    <Pencil size={14} />编辑
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm btn--danger-text" onClick={() => setDeleteId(rule.id)}>
                    <Trash2 size={14} />删除规则
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="settings-note">自动补记只在打开 App 后执行，不依赖后台服务；默认只处理到昨天，不会提前给今天计薪。</p>

      {editorId ? (
        <RuleEditor
          key={editorId}
          rule={editing}
          onClose={() => setEditorId(null)}
          onSave={(input) => {
            const saved = editing
              ? updateRecurringRule({ ...editing, ...input })
              : addRecurringRule(input);
            if (!saved) {
              toast('规则保存失败，请检查工作、日期、工时和计件数量', 'error');
              return;
            }
            setEditorId(null);
            toast(editing ? '周期规则已更新' : '周期规则已创建');
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="删除这条周期规则？"
        description="只停止以后生成，已经入账的工记会完整保留。此操作不需要删除任何历史记录。"
        confirmLabel="删除规则"
        danger
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (!deleteId) return;
          const ok = deleteRecurringRule(deleteId);
          setDeleteId(null);
          toast(
            ok ? '周期规则已删除，历史工记未改动' : '这条规则已经不存在了，请返回后重试',
            ok ? 'info' : 'error',
          );
        }}
      />
    </SubPage>
  );
}

function RuleEditor({
  rule,
  onClose,
  onSave,
}: {
  rule?: RecurringRule;
  onClose: () => void;
  onSave: (input: NewRecurringRuleInput) => void;
}) {
  const { state } = useStore();
  const jobs = state.jobs.filter((job) => !job.archived || job.id === rule?.jobId);
  const initialJob = jobs.find((job) => job.id === rule?.jobId) ?? jobs[0];
  const [jobId, setJobId] = useState(initialJob?.id ?? '');
  const [frequency, setFrequency] = useState<RecurringFrequency>(rule?.frequency ?? 'weekly');
  const [weekdays, setWeekdays] = useState<number[]>(rule?.weekdays ?? [1, 2, 3, 4, 5]);
  const [dayOfMonth, setDayOfMonth] = useState(String(rule?.dayOfMonth ?? 1));
  const [startDate, setStartDate] = useState(rule?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(rule?.endDate ?? '');
  const [hours, setHours] = useState(
    String(rule?.hours ?? (initialJob ? plannedEntryHours(initialJob) : 8)),
  );
  const [quantity, setQuantity] = useState(String(rule?.quantity ?? 1));
  const [bonus, setBonus] = useState(String(rule?.bonus ?? 0));
  const [deduction, setDeduction] = useState(String(rule?.deduction ?? 0));
  const [note, setNote] = useState(rule?.note ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [auto, setAuto] = useState(rule?.auto ?? false);
  const [error, setError] = useState('');
  const job = jobs.find((item) => item.id === jobId);
  const isPiece = job?.rule.payType === 'piece';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const day = Math.round(toAmount(dayOfMonth));
    const hoursValue = toAmount(hours);
    const quantityValue = toAmount(quantity);
    if (!job || job.archived) return setError('请选择一份进行中的工作');
    if (!startDate || (endDate && endDate < startDate)) return setError('请检查开始和结束日期');
    if (frequency === 'weekly' && weekdays.length === 0) return setError('每周规则至少选择一天');
    if (frequency === 'monthly' && (day < 1 || day > 31)) return setError('每月日期需在 1–31 之间');
    if (hoursValue < 0 || hoursValue > 24 || (job.rule.payType === 'hourly' && hoursValue <= 0)) {
      return setError('工时需在 0–24 小时之间；时薪工作必须大于 0');
    }
    if (isPiece && quantityValue <= 0) return setError('计件数量需要大于 0');
    onSave({
      jobId,
      frequency,
      weekdays: frequency === 'weekly' ? weekdays : [],
      dayOfMonth: day,
      startDate,
      endDate: endDate || undefined,
      hours: hoursValue,
      quantity: isPiece ? quantityValue : 0,
      bonus: Math.max(0, toAmount(bonus)),
      deduction: Math.max(0, toAmount(deduction)),
      note: note.trim() || undefined,
      enabled,
      auto,
    });
  };

  return (
    <Sheet open title={rule ? '编辑周期规则' : '新建周期规则'} subtitle="按规则生成普通工记，之后仍可逐笔核对" onClose={onClose}>
      <form className="advance-form" onSubmit={submit}>
        <div className="sheet-body recurring-form">
          <label className="field">
            <span className="field-label">工作</span>
            <select className="text-input" value={jobId} onChange={(event) => {
              const next = jobs.find((item) => item.id === event.target.value);
              setJobId(event.target.value);
              if (next) setHours(String(plannedEntryHours(next)));
            }} aria-label="周期规则工作">
              {jobs.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="field">
            <span className="field-label">重复方式</span>
            <Segmented value={frequency} onChange={setFrequency} options={[
              { value: 'daily', label: '每天' }, { value: 'weekly', label: '每周' }, { value: 'monthly', label: '每月' },
            ]} ariaLabel="周期频率" />
          </div>
          {frequency === 'weekly' ? (
            <div className="field">
              <span className="field-label">工作日</span>
              <div className="recurring-weekdays">
                {WEEKDAYS.map((day) => (
                  <button type="button" key={day.value} className={weekdays.includes(day.value) ? 'is-active' : ''}
                    aria-pressed={weekdays.includes(day.value)} onClick={() => setWeekdays((current) =>
                      current.includes(day.value) ? current.filter((value) => value !== day.value) : [...current, day.value])}>
                    周{day.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {frequency === 'monthly' ? (
            <label className="field"><span className="field-label">每月第几天</span>
              <input className="text-input" type="number" min={1} max={31} value={dayOfMonth} onChange={(event) => setDayOfMonth(event.target.value)} />
              <p className="field-hint">选择 29–31 日时，没有该日期的月份会落到月末。</p>
            </label>
          ) : null}
          <div className="two-col">
            <label className="field"><span className="field-label">开始日期</span><input className="text-input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="field"><span className="field-label">结束日期（可选）</span><input className="text-input" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
          <p className="field-hint">开始日期早于 120 天前时，只补记最近 120 天，避免一次生成太多工记。</p>
          <div className="two-col">
            <label className="field"><span className="field-label">每次工时</span><input className="text-input" type="number" min={0} max={24} step={0.5} value={hours} onChange={(event) => setHours(event.target.value)} inputMode="decimal" /></label>
            {isPiece ? <label className="field"><span className="field-label">每次{job.rule.unitLabel || '件'}数</span><input className="text-input" type="number" min={0} step={0.01} value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" /></label> : <span />}
          </div>
          <div className="two-col">
            <label className="field"><span className="field-label">每次奖金</span><input className="text-input" type="number" min={0} step={0.01} value={bonus} onChange={(event) => setBonus(event.target.value)} /></label>
            <label className="field"><span className="field-label">每次扣款</span><input className="text-input" type="number" min={0} step={0.01} value={deduction} onChange={(event) => setDeduction(event.target.value)} /></label>
          </div>
          <label className="field"><span className="field-label">备注</span><input className="text-input" value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} placeholder="默认：周期记工" /></label>
          <div className="settings-card recurring-switches">
            <div className="settings-row"><span className="settings-body"><strong>启用规则</strong><em>关闭后不再生成，可随时恢复</em></span>
              <button type="button" className={`switch ${enabled ? 'is-on' : ''}`} role="switch" aria-checked={enabled} aria-label="启用周期规则" onClick={() => setEnabled((value) => !value)}><i /></button></div>
            <div className="settings-row"><span className="settings-body"><strong>打开 App 自动补到昨天</strong><em>默认关闭；跳过冲突，不提前记今天</em></span>
              <button type="button" className={`switch ${auto ? 'is-on' : ''}`} role="switch" aria-checked={auto} aria-label="自动补记周期工记" onClick={() => setAuto((value) => !value)}><i /></button></div>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <div className="sheet-footer"><button type="button" className="btn btn--ghost" onClick={onClose}>取消</button><button type="submit" className="btn btn--primary">保存规则</button></div>
      </form>
    </Sheet>
  );
}
