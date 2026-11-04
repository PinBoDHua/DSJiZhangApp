import { useState, type FormEvent } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Logo, Wordmark } from '../components/Logo';
import { Segmented } from '../components/Segmented';
import { useStore } from '../store';
import type { Cycle, JobColor, PayType } from '../types';
import { toAmount } from '../lib/money';
import { PAY_TYPE_LABEL, PAY_TYPE_UNIT } from '../lib/meta';

const COLORS: Record<PayType, JobColor> = {
  hourly: 'pine',
  daily: 'amber',
  monthly: 'clay',
  piece: 'olive',
};

export function Onboarding() {
  const store = useStore();
  const [name, setName] = useState('');
  const [jobName, setJobName] = useState('');
  const [payType, setPayType] = useState<PayType>('hourly');
  const [rate, setRate] = useState('25');
  const [unitLabel, setUnitLabel] = useState('件');
  const [cycle, setCycle] = useState<Cycle>('weekly');
  const [error, setError] = useState('');

  const effectiveCycle: Cycle = payType === 'monthly' ? 'monthly' : cycle;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!jobName.trim()) {
      setError('给你的工作起个名字吧，比如「城南工地」');
      return;
    }
    const parsedRate = toAmount(rate);
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
      setError('单价需要大于 0');
      return;
    }
    setError('');
    store.completeOnboarding(name, {
      name: jobName.trim(),
      color: COLORS[payType],
      cycle: effectiveCycle,
      rule: {
        payType,
        rate: parsedRate,
        standardHours: 8,
        expectedDays: 22,
        monthlyMode: 'prorated',
        restDaysPerMonth: 0,
        unitLabel: unitLabel.trim() || '件',
        otEnabled: payType !== 'piece',
        weekdayOT: 1.5,
        weekendOT: 2,
        holidayOT: 3,
      },
      shift: { startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
    });
  };

  return (
    <div className="onboarding">
      <div className="onboarding-hero">
        <div className="onboarding-orbit onboarding-orbit--one" aria-hidden="true" />
        <div className="onboarding-orbit onboarding-orbit--two" aria-hidden="true" />
        <div className="onboarding-top">
          <div className="brand-lockup">
            <Logo size={34} light />
            <Wordmark light />
          </div>
          <span className="onboarding-badge">v0.4.4 · MVP</span>
        </div>
        <div className="onboarding-copy">
          <p className="onboarding-eyebrow">工时 · 薪资 · 结算</p>
          <h1>
            每一小时，
            <br />
            <span>都算数。</span>
          </h1>
          <p className="onboarding-sub">
            给打零工的你，一本清楚的账。记工时、算工钱、等发薪，不用再靠脑子记。
          </p>
          <div className="onboarding-tags">
            <span>小时工</span>
            <span>日结</span>
            <span>周结</span>
            <span>月结</span>
            <span>计件</span>
          </div>
        </div>
      </div>

      <main className="onboarding-main">
        <form className="onboarding-card" onSubmit={submit}>
          <div className="onboarding-card-head">
            <span className="step-dot">01</span>
            <div>
              <h2>先建一份工作</h2>
              <p>之后可以继续添加，每份工作单独算账。</p>
            </div>
          </div>

          <label className="field">
            <span className="field-label">怎么称呼你</span>
            <input
              className="text-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="李师傅（选填）"
              maxLength={12}
            />
          </label>

          <label className="field">
            <span className="field-label">工作名称</span>
            <input
              className="text-input"
              value={jobName}
              onChange={(event) => {
                setJobName(event.target.value);
                if (error) setError('');
              }}
              placeholder="比如：城南工地 / 顺丰分拣"
              maxLength={20}
            />
          </label>

          <div className="field">
            <span className="field-label">工资怎么算</span>
            <Segmented
              value={payType}
              onChange={(value) => {
                setPayType(value);
                if (value === 'monthly') setCycle('monthly');
              }}
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
                value={rate}
                onChange={(event) => {
                  setRate(event.target.value);
                  if (error) setError('');
                }}
                inputMode="decimal"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
              />
              <span className="money-input-suffix">
                / {payType === 'piece' ? unitLabel.trim() || '件' : PAY_TYPE_UNIT[payType]}
              </span>
            </div>
          </label>

          {payType === 'piece' ? (
            <label className="field">
              <span className="field-label">计件单位</span>
              <input
                className="text-input"
                value={unitLabel}
                onChange={(event) => setUnitLabel(event.target.value)}
                placeholder="件 / 米 / 平方"
                maxLength={8}
              />
              <p className="field-hint">数量按这个单位记，之后也可以修改。</p>
            </label>
          ) : null}

          <div className="field">
            <span className="field-label">什么时候结</span>
            <Segmented
              value={effectiveCycle}
              onChange={setCycle}
              options={[
                ...(payType === 'monthly'
                  ? []
                  : ([
                      { value: 'daily' as Cycle, label: '日结' },
                      { value: 'weekly' as Cycle, label: '周结' },
                    ] as const)),
                { value: 'monthly' as Cycle, label: '月结' },
              ]}
              ariaLabel="结算周期"
            />
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          <button type="submit" className="btn btn--primary btn--block onboarding-submit">
            开始记工
            <ArrowRight size={18} />
          </button>

          <div className="onboarding-trust">
            <span>无需注册</span>
            <i />
            <span>离线可用</span>
            <i />
            <span>数据只存本机</span>
          </div>
        </form>

        <button
          type="button"
          className="demo-link"
          onClick={() => {
            store.loadDemo();
            store.toast('示例数据已载入，随便看看', 'info');
          }}
        >
          <Sparkles size={16} />
          先看看示例数据
        </button>

        <p className="onboarding-fineprint">
          薪时是个人记工工具，计算结果仅供参考，实际工资以用人单位约定为准。
        </p>
      </main>
    </div>
  );
}
