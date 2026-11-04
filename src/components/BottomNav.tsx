import { ChartColumn, ClipboardList, House, UserRound, Wallet } from 'lucide-react';

export type TabKey = 'home' | 'records' | 'settlements' | 'stats' | 'profile';

const TABS = [
  { key: 'home' as const, label: '首页', icon: House },
  { key: 'records' as const, label: '记录', icon: ClipboardList },
  { key: 'settlements' as const, label: '结算', icon: Wallet },
  { key: 'stats' as const, label: '统计', icon: ChartColumn },
  { key: 'profile' as const, label: '我的', icon: UserRound },
];

export function BottomNav({
  active,
  onChange,
  timerRunning = false,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  timerRunning?: boolean;
}) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      <div className="bottom-nav-inner">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            className={`nav-item ${active === key ? 'is-active' : ''}`}
            onClick={() => onChange(key)}
            aria-current={active === key ? 'page' : undefined}
            aria-label={key === 'home' && timerRunning ? `${label}，计时进行中` : label}
          >
            <span className="nav-icon-wrap">
              <Icon size={21} strokeWidth={active === key ? 2.3 : 1.9} />
              {key === 'home' && timerRunning ? (
                <i className="nav-timer-dot" aria-hidden="true" />
              ) : null}
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
