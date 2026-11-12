import { useState, type FormEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { useStore } from '../store';
import { todayISO } from '../lib/date';
import { toAmount } from '../lib/money';
import type { Advance } from '../types';
import { Sheet } from './Sheet';
import { Money } from './Money';

interface AdvanceSheetProps {
  open: boolean;
  jobId: string;
  defaultDate?: string;
  hint?: string;
  onClose: () => void;
  onAdded?: (advance: Advance) => void;
}

export function AdvanceSheet({
  open,
  jobId,
  defaultDate,
  hint,
  onClose,
  onAdded,
}: AdvanceSheetProps) {
  const { state, addAdvance, toast } = useStore();
  const job = state.jobs.find((item) => item.id === jobId);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(defaultDate ?? todayISO());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = toAmount(amount);
    if (!(parsed > 0)) {
      setError('借支金额需要大于 0');
      return;
    }
    if (parsed > 1000000) {
      setError('金额也太大了，确认一下');
      return;
    }
    if (!date) {
      setError('请选择借支日期');
      return;
    }
    const advance = addAdvance({
      jobId,
      date,
      amount: parsed,
      note: note.trim() || undefined,
    });
    if (!advance) {
      setError('没有保存：工作已归档、日期无效，或借支日期已在结算周期内');
      return;
    }
    toast('借支已记上', 'success');
    setAmount('');
    setNote('');
    setError('');
    onAdded?.(advance);
    onClose();
  };

  return (
    <Sheet open={open} title="记一笔借支" subtitle={job ? job.name : undefined} onClose={onClose}>
      <form className="advance-form" onSubmit={submit}>
        <div className="sheet-body">
          <div className="advance-amount">
            <span>借支金额</span>
            <div className="big-money-input">
              <span>¥</span>
              <input
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError('');
                }}
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                placeholder="0.00"
                aria-label="借支金额"
                autoFocus
              />
            </div>
          </div>

          <label className="field">
            <span className="field-label">借支日期</span>
            <div className="date-native date-native--block">
              <CalendarDays size={16} />
              <span>{date}</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label="借支日期"
              />
            </div>
          </label>

          <label className="field">
            <span className="field-label">备注</span>
            <input
              className="text-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：预支生活费（选填）"
              maxLength={40}
            />
          </label>

          {hint ? <p className="inline-hint">{hint}</p> : null}
          <div className="advance-preview">
            <span>这次先拿到</span>
            <Money value={toAmount(amount)} className="advance-preview-money" />
            <p>结算时会从工钱里自动抵扣。</p>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
        <div className="sheet-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn--primary">
            记上借支
          </button>
        </div>
      </form>
    </Sheet>
  );
}
