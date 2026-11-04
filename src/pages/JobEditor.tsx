import { useState } from 'react';
import { Archive, Briefcase, Check, RotateCcw, Trash2 } from 'lucide-react';
import type { Cycle, Job, JobColor, PayRule, PayType } from '../types';
import { useStore } from '../store';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { JobDot } from '../components/JobDot';
import { SubPage } from '../components/SubPage';
import { Segmented } from '../components/Segmented';
import { CYCLE_LABEL, JOB_COLORS, PAY_TYPE_LABEL, PAY_TYPE_UNIT, rateLabel } from '../lib/meta';
import { toAmount } from '../lib/money';

interface JobEditorProps {
  jobId?: string;
  onBack: () => void;
}

export function JobEditor({ jobId, onBack }: JobEditorProps) {
  const { state, addJob, updateJob, setJobArchived, deleteJob, toast } = useStore();
  const existing = jobId ? state.jobs.find((item) => item.id === jobId) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [employer, setEmployer] = useState(existing?.employer ?? '');
  const [color, setColor] = useState<JobColor>(existing?.color ?? 'pine');
  const [payType, setPayType] = useState<PayType>(existing?.rule.payType ?? 'hourly');
  const [rate, setRate] = useState(existing ? String(existing.rule.rate) : '25');
  const [unitLabel, setUnitLabel] = useState(existing?.rule.unitLabel ?? '件');
  const [cycle, setCycle] = useState<Cycle>(existing?.cycle ?? 'weekly');
  const [standardHours, setStandardHours] = useState(
    existing ? String(existing.rule.standardHours) : '8',
  );
  const [expectedDays, setExpectedDays] = useState(
    existing ? String(existing.rule.expectedDays) : '22',
  );
  const [otEnabled, setOtEnabled] = useState(existing?.rule.otEnabled ?? true);
  const [weekdayOT, setWeekdayOT] = useState(
    existing ? String(existing.rule.weekdayOT) : '1.5',
  );
  const [weekendOT, setWeekendOT] = useState(existing ? String(existing.rule.weekendOT) : '2');
  const [holidayOT, setHolidayOT] = useState(existing ? String(existing.rule.holidayOT) : '3');
  const [error, setError] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const pendingCount = state.entries.filter(
    (entry) => entry.jobId === jobId && !entry.settlementId,
  ).length;
  const isPiece = payType === 'piece';
  const timerActive = Boolean(existing && state.activeTimer?.jobId === existing.id);
  const canDelete =
    Boolean(existing) &&
    !timerActive &&
    !state.entries.some((entry) => entry.jobId === jobId) &&
    !state.advances.some((advance) => advance.jobId === jobId) &&
    !state.settlements.some((settlement) => settlement.jobId === jobId);

  const cycleOptions: Array<{ value: Cycle; label: string }> =
    payType === 'monthly'
      ? [{ value: 'monthly', label: '月结' }]
      : [
          { value: 'daily', label: '日结' },
          { value: 'weekly', label: '周结' },
          { value: 'monthly', label: '月结' },
        ];

  const changePayType = (next: PayType) => {
    setPayType(next);
    if (next === 'monthly') setCycle('monthly');
  };

  const save = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('给工作起个名字吧');
      return;
    }
    const parsedRate = toAmount(rate);
    if (!(parsedRate > 0)) {
      setError('单价要大于 0');
      return;
    }
    const parsedStandard = toAmount(standardHours, 8);
    if (!(parsedStandard > 0)) {
      setError('标准工时要大于 0');
      return;
    }
    const parsedExpected = Math.max(1, Math.round(toAmount(expectedDays, 22)));
    const parsedUnit = (unitLabel.trim() || '件').slice(0, 8);
    if (isPiece && !parsedUnit) {
      setError('请填写计件单位，比如 件 / 米 / 平方');
      return;
    }
    const weekday = toAmount(weekdayOT, 1.5);
    const weekend = toAmount(weekendOT, 2);
    const holiday = toAmount(holidayOT, 3);
    if (!isPiece && otEnabled && (weekday < 1 || weekend < 1 || holiday < 1)) {
      setError('加班倍率不能小于 1');
      return;
    }
    const rule: PayRule = {
      payType,
      rate: parsedRate,
      standardHours: parsedStandard,
      expectedDays: parsedExpected,
      unitLabel: parsedUnit,
      otEnabled: isPiece ? false : otEnabled,
      weekdayOT: weekday,
      weekendOT: weekend,
      holidayOT: holiday,
    };
    const normalizedCycle: Cycle = payType === 'monthly' ? 'monthly' : cycle;
    setError('');
    if (existing) {
      const next: Job = {
        ...existing,
        name: trimmedName,
        employer: employer.trim() || undefined,
        color,
        rule,
        cycle: normalizedCycle,
      };
      updateJob(next);
      toast('工作设置已保存');
    } else {
      addJob({
        name: trimmedName,
        employer: employer.trim() || undefined,
        color,
        rule,
        cycle: normalizedCycle,
      });
      toast('工作已创建');
    }
    onBack();
  };

  const handleArchive = () => {
    if (!existing) return;
    if (timerActive) {
      setArchiveOpen(false);
      toast('这份工作正在计时，先结束或放弃计时', 'error');
      return;
    }
    const ok = setJobArchived(existing.id, !existing.archived);
    setArchiveOpen(false);
    if (!ok) {
      toast('这份工作正在计时，先结束或放弃计时', 'error');
      return;
    }
    toast(existing.archived ? '工作已恢复' : '工作已归档', 'info');
    onBack();
  };

  const handleDelete = () => {
    if (!existing) return;
    const ok = deleteJob(existing.id);
    setDeleteOpen(false);
    if (ok) {
      toast('工作已删除', 'info');
      onBack();
    } else {
      toast('这份工作已经有记录，只能归档', 'error');
    }
  };

  if (jobId && !existing) {
    return (
      <SubPage title="编辑工作" onBack={onBack}>
        <div className="card">
          <EmptyState
            icon={Briefcase}
            title="找不到这份工作"
            description="它可能已经被删除。"
            actionLabel="返回"
            onAction={onBack}
          />
        </div>
      </SubPage>
    );
  }

  return (
    <>
      <SubPage
        title={existing ? '编辑工作' : '新建工作'}
        subtitle={existing ? existing.name : '设置好规则，之后记工自动算'}
        onBack={onBack}
        footer={
          <div className="job-editor-footer">
            {error ? <p className="form-error">{error}</p> : null}
            <div className="job-editor-footer-row">
              <div>
                <span>保存后</span>
                <strong>
                  {rateLabel(payType, toAmount(rate), unitLabel)} · {CYCLE_LABEL[cycle]}
                </strong>
              </div>
              <button type="button" className="btn btn--primary" onClick={save}>
                保存
              </button>
            </div>
          </div>
        }
      >
        {existing?.archived ? (
          <div className="inline-notice">
            <Archive size={15} />
            这份工作已归档，不会出现在首页和记工选择里。
          </div>
        ) : null}

        <section className="rule-preview">
          <span className="rule-preview-dot" style={{ background: JOB_COLORS.find((item) => item.key === color)?.main }} />
          <div>
            <strong>{name.trim() || '新工作'}</strong>
            <p>
              {PAY_TYPE_LABEL[payType]} {toAmount(rate) > 0 ? `¥${toAmount(rate)}` : '—'} /{' '}
              {payType === 'piece' ? unitLabel.trim() || '件' : PAY_TYPE_UNIT[payType]} ·{' '}
              {CYCLE_LABEL[cycle]} ·{' '}
              {isPiece
                ? '按数量计'
                : otEnabled
                  ? `加班 ${toAmount(weekdayOT, 1.5)}× 起`
                  : '不含加班费'}
            </p>
          </div>
        </section>

        <section className="editor-section">
          <h2>基本信息</h2>
          <div className="editor-card">
            <label className="field">
              <span className="field-label">工作名称</span>
              <input
                className="text-input"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError('');
                }}
                placeholder="例如：城南工地 / 顺丰分拣"
                maxLength={20}
                autoFocus={!existing}
              />
            </label>
            <label className="field">
              <span className="field-label">雇主 / 地点（选填）</span>
              <input
                className="text-input"
                value={employer}
                onChange={(event) => setEmployer(event.target.value)}
                placeholder="例如：城南 · 三号院"
                maxLength={24}
              />
            </label>
            <div className="field">
              <span className="field-label">颜色标记</span>
              <div className="color-picker">
                {JOB_COLORS.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className={`color-swatch ${color === item.key ? 'is-active' : ''}`}
                    style={{ background: item.main }}
                    onClick={() => setColor(item.key)}
                    aria-label={item.label}
                    aria-pressed={color === item.key}
                  >
                    {color === item.key ? <Check size={15} /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="editor-section">
          <h2>工资怎么算</h2>
          <div className="editor-card">
            <div className="field">
              <span className="field-label">计薪方式</span>
              <Segmented
                value={payType}
                onChange={changePayType}
                options={(['hourly', 'daily', 'monthly', 'piece'] as PayType[]).map((value) => ({
                  value,
                  label: PAY_TYPE_LABEL[value],
                }))}
                ariaLabel="计薪方式"
              />
            </div>
            <label className="field">
              <span className="field-label">{PAY_TYPE_LABEL[payType]}单价</span>
              <div className="money-input">
                <span className="money-input-prefix">¥</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={rate}
                  onChange={(event) => {
                    setRate(event.target.value);
                    if (error) setError('');
                  }}
                  inputMode="decimal"
                  placeholder="0"
                />
                <span className="money-input-suffix">
                  / {isPiece ? unitLabel.trim() || '件' : PAY_TYPE_UNIT[payType]}
                </span>
              </div>
            </label>
            {isPiece ? (
              <label className="field">
                <span className="field-label">计件单位</span>
                <input
                  className="text-input"
                  value={unitLabel}
                  onChange={(event) => {
                    setUnitLabel(event.target.value);
                    if (error) setError('');
                  }}
                  placeholder="件 / 米 / 平方"
                  maxLength={8}
                />
                <p className="field-hint">记数量时显示的单位，历史记录会保留当时的单位。</p>
              </label>
            ) : null}
            <div className="field">
              <span className="field-label">结算周期</span>
              <Segmented
                value={cycle}
                onChange={setCycle}
                options={cycleOptions}
                ariaLabel="结算周期"
              />
              {payType === 'monthly' ? (
                <p className="field-hint">月薪默认按自然月结算。</p>
              ) : (
                <p className="field-hint">工资按这个周期汇总，可以逐期结算。</p>
              )}
            </div>
            {!isPiece ? (
              <>
                <label className="field">
                  <span className="field-label">标准工时 / 天</span>
                  <div className="inline-number">
                    <input
                      type="number"
                      min={1}
                      max={16}
                      step={0.5}
                      value={standardHours}
                      onChange={(event) => setStandardHours(event.target.value)}
                      inputMode="decimal"
                    />
                    <span>小时</span>
                  </div>
                  <p className="field-hint">
                    {payType === 'hourly'
                      ? '超过这个时长会自动计为加班。'
                      : '用来折算加班时薪。'}
                  </p>
                </label>
                {payType === 'monthly' ? (
                  <label className="field">
                    <span className="field-label">月计薪天数</span>
                    <div className="inline-number">
                      <input
                        type="number"
                        min={1}
                        max={31}
                        step={1}
                        value={expectedDays}
                        onChange={(event) => setExpectedDays(event.target.value)}
                        inputMode="numeric"
                      />
                      <span>天</span>
                    </div>
                    <p className="field-hint">月薪按这个天数折算日薪，默认 22 天。</p>
                  </label>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        {!isPiece ? (
          <section className="editor-section">
            <h2>加班费</h2>
            <div className="editor-card">
              <button
                type="button"
                className={`switch-row ${otEnabled ? 'is-on' : ''}`}
                role="switch"
                aria-checked={otEnabled}
                onClick={() => setOtEnabled((value) => !value)}
              >
                <span>
                  计算加班费
                  <em>超出标准工时或周末 / 节假日上工时</em>
                </span>
                <span className="switch-track">
                  <i />
                </span>
              </button>
              {otEnabled ? (
                <>
                  <div className="ot-rates">
                    <label>
                      <span>平日</span>
                      <div className="rate-input">
                        <input
                          type="number"
                          min={1}
                          max={5}
                          step={0.1}
                          value={weekdayOT}
                          onChange={(event) => setWeekdayOT(event.target.value)}
                          inputMode="decimal"
                        />
                        <em>×</em>
                      </div>
                    </label>
                    <label>
                      <span>周末</span>
                      <div className="rate-input">
                        <input
                          type="number"
                          min={1}
                          max={5}
                          step={0.1}
                          value={weekendOT}
                          onChange={(event) => setWeekendOT(event.target.value)}
                          inputMode="decimal"
                        />
                        <em>×</em>
                      </div>
                    </label>
                    <label>
                      <span>节假日</span>
                      <div className="rate-input">
                        <input
                          type="number"
                          min={1}
                          max={5}
                          step={0.1}
                          value={holidayOT}
                          onChange={(event) => setHolidayOT(event.target.value)}
                          inputMode="decimal"
                        />
                        <em>×</em>
                      </div>
                    </label>
                  </div>
                  <p className="field-hint">
                    {payType === 'hourly'
                      ? '时薪超过标准工时的部分自动计加班；周末自动按倍率。'
                      : '加班时长在记工时可填，周末自动按倍率。'}
                  </p>
                </>
              ) : (
                <p className="field-hint">关闭后所有工时按基础单价计算，不再产生加班费。</p>
              )}
            </div>
          </section>
        ) : (
          <p className="inline-hint">
            计件工资按「数量 × 单价」计算，不参与加班费；工时仅用于统计。
          </p>
        )}

        {existing ? (
          <section className="editor-section">
            <h2>管理</h2>
            <div className="editor-card">
              <button
                type="button"
                className="settings-row settings-row--plain"
                onClick={() => {
                  if (timerActive) {
                    toast('这份工作正在计时，先结束或放弃计时', 'error');
                    return;
                  }
                  setArchiveOpen(true);
                }}
              >
                <span className="settings-icon">
                  {existing.archived ? <RotateCcw size={18} /> : <Archive size={18} />}
                </span>
                <span className="settings-body">
                  <strong>{existing.archived ? '恢复工作' : '归档工作'}</strong>
                  <em>
                    {existing.archived
                      ? '重新出现在首页和记工选择中'
                      : timerActive
                        ? '正在计时，先结束或放弃计时'
                        : pendingCount > 0
                          ? `还有 ${pendingCount} 笔未结工记，归档后仍可结算`
                          : '从首页隐藏，历史记录保留'}
                  </em>
                </span>
              </button>
              {canDelete ? (
                <button
                  type="button"
                  className="settings-row settings-row--plain settings-row--danger"
                  onClick={() => setDeleteOpen(true)}
                >
                  <span className="settings-icon">
                    <Trash2 size={18} />
                  </span>
                  <span className="settings-body">
                    <strong>删除工作</strong>
                    <em>没有任何记录，可以彻底删除</em>
                  </span>
                </button>
              ) : (
                <p className="editor-delete-hint">
                  {timerActive
                    ? '这份工作正在计时，结束或放弃计时后才能归档 / 删除。'
                    : '已有工记或结算记录，不能删除；如果不再使用，可以归档。'}
                </p>
              )}
            </div>
          </section>
        ) : null}

        <p className="jobs-footnote">
          修改单价或规则只影响之后的新工记；已经记下的工记会保留当时的单价和倍率。
        </p>
      </SubPage>

      <ConfirmDialog
        open={archiveOpen}
        title={existing?.archived ? '恢复这份工作？' : '归档这份工作？'}
        description={
          existing?.archived
            ? '恢复后会重新出现在首页和记工选择里，历史数据不变。'
            : pendingCount > 0
              ? `还有 ${pendingCount} 笔未结工记。归档后不能再记新工，但仍可在结算页处理。`
              : '归档后会从首页隐藏，历史记录和结算不受影响，随时可以恢复。'
        }
        confirmLabel={existing?.archived ? '恢复' : '归档'}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={handleArchive}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="彻底删除这份工作？"
        description="删除后无法恢复。只有没有任何工记、借支和结算的工作才能删除。"
        confirmLabel="删除"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
      />
    </>
  );
}
