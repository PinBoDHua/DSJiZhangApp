import { useEffect, useState, type FormEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import type { Settlement } from '../types';
import { useStore } from '../store';
import { todayISO } from '../lib/date';
import { toAmount } from '../lib/money';
import { paidAmountOf, remainingAmountOf } from '../lib/payment';
import { Money } from './Money';
import { Sheet } from './Sheet';

const METHODS = ['微信', '支付宝', '现金', '银行卡', '其他'];

interface PaymentSheetProps {
  open: boolean;
  settlement: Settlement;
  onClose: () => void;
}

export function PaymentSheet({ open, settlement, onClose }: PaymentSheetProps) {
  const { setSettlementPayment, toast } = useStore();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState('微信');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setAmount(String(paidAmountOf(settlement)));
    setDate(settlement.paidAt ?? todayISO());
    setMethod(settlement.paymentMethod ?? '微信');
    setNote(settlement.paymentNote ?? '');
    setError('');
  }, [open, settlement]);

  const paidValue = toAmount(amount);
  const remaining = remainingAmountOf(settlement);
  const previewStatus =
    paidValue <= 0 ? '待发' : paidValue >= settlement.net ? '已发' : '部分发放';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (paidValue < 0) {
      setError('已收金额不能小于 0');
      return;
    }
    if (paidValue > settlement.net) {
      setError('已收金额不能超过应发金额');
      return;
    }
    if (!date) {
      setError('请选择收款日期');
      return;
    }
    const ok = setSettlementPayment(settlement.id, {
      paidAmount: paidValue,
      paidAt: date,
      method,
      note,
    });
    if (!ok) {
      setError('收款登记失败，请重试');
      return;
    }
    toast(paidValue >= settlement.net ? '已标记为全部收清' : '收款已登记');
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="登记收款"
      subtitle={settlement.jobName}
      onClose={onClose}
    >
      <form className="advance-form" onSubmit={submit}>
        <div className="sheet-body">
          <div className="payment-summary">
            <div>
              <span>应发</span>
              <Money value={settlement.net} />
            </div>
            <div>
              <span>还剩</span>
              <Money value={remaining} />
            </div>
          </div>

          <div className="advance-amount">
            <span>已收总额（含之前）</span>
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
                max={settlement.net}
                step={0.01}
                inputMode="decimal"
                placeholder="0.00"
                autoFocus
              />
            </div>
            <div className="payment-quick">
              <button
                type="button"
                className="text-link"
                onClick={() => setAmount(String(settlement.net))}
              >
                全部收清
              </button>
              <span>当前：{previewStatus}</span>
            </div>
          </div>

          <label className="field">
            <span className="field-label">收款日期</span>
            <div className="date-native date-native--block">
              <CalendarDays size={16} />
              <span>{date}</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                aria-label="收款日期"
              />
            </div>
          </label>

          <div className="field">
            <span className="field-label">收款方式</span>
            <div className="job-picker payment-methods">
              {METHODS.map((item) => (
                <button
                  type="button"
                  key={item}
                  className={`job-choice ${method === item ? 'is-active' : ''}`}
                  onClick={() => setMethod(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">备注（选填）</span>
            <input
              className="text-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：老板微信转账 / 先结一半"
              maxLength={60}
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}
        </div>
        <div className="sheet-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn--primary">
            保存收款
          </button>
        </div>
      </form>
    </Sheet>
  );
}
