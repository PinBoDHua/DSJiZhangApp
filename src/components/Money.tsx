import { createContext, useContext, type ReactNode } from 'react';
import { formatMoney, splitMoney } from '../lib/money';

const PrivacyContext = createContext(false);

export function PrivacyProvider({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  return <PrivacyContext.Provider value={hidden}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): boolean {
  return useContext(PrivacyContext);
}

interface MoneyProps {
  value: number;
  className?: string;
  symbol?: boolean;
  decimals?: boolean;
  signed?: boolean;
  mask?: boolean;
}

/** 统一金额排版：整数与小数分级，尊重全局隐私开关 */
export function Money({
  value,
  className = '',
  symbol = true,
  decimals = true,
  signed = false,
  mask = true,
}: MoneyProps) {
  const hidden = usePrivacy();
  if (hidden && mask) {
    return (
      <span className={`money money--masked ${className}`} aria-label="金额已隐藏">
        {symbol ? '¥' : ''} ••••
      </span>
    );
  }
  const { negative, int, decimal } = splitMoney(value);
  const sign = negative ? '−' : signed && value > 0 ? '+' : '';
  return (
    <span
      className={`money ${negative ? 'is-negative' : ''} ${className}`}
      aria-label={formatMoney(value, { symbol })}
    >
      {sign ? <span className="money-sign">{sign}</span> : null}
      {symbol ? <span className="money-sym">¥</span> : null}
      <span className="money-int">{int}</span>
      {decimals ? <span className="money-dec">.{decimal}</span> : null}
    </span>
  );
}
