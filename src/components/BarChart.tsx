import { useEffect, useState } from 'react';
import { formatMoney } from '../lib/money';
import { formatDateWithWeekday } from '../lib/date';

export interface BarPoint {
  date: string;
  label: string;
  value: number;
  highlight?: boolean;
}

interface BarChartProps {
  data: BarPoint[];
  height?: number;
  labelEvery?: number;
  showGrid?: boolean;
  className?: string;
}

export function BarChart({
  data,
  height = 150,
  labelEvery,
  showGrid = true,
  className = '',
}: BarChartProps) {
  const max = Math.max(...data.map((point) => point.value), 1);
  const every = labelEvery ?? (data.length > 10 ? 5 : 1);

  // 首次挂载从 0 长到目标高度，让入场动画真正触发；后续数据变化沿用高度过渡。
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={`bar-chart ${className}`} style={{ height }}>
      {showGrid ? (
        <div className="bar-grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      <div className="bar-cols">
        {data.map((point, index) => {
          const ratio = point.value > 0 ? Math.max(6, (point.value / max) * 100) : 0;
          const showLabel =
            data.length <= 10 ||
            index === 0 ||
            index === data.length - 1 ||
            (index + 1) % every === 0;
          return (
            <div
              className={`bar-col ${point.highlight ? 'is-highlight' : ''}`}
              key={point.date}
              role="img"
              aria-label={`${formatDateWithWeekday(point.date)}，${formatMoney(point.value, {
                symbol: true,
              })}`}
            >
              <div className="bar-track">
                <div className="bar-stack">
                  {point.highlight && point.value > 0 ? (
                    <span className="bar-peak">
                      {formatMoney(point.value, { symbol: true })}
                    </span>
                  ) : null}
                  <div
                    className="bar-fill"
                    style={{
                      height: `${grown ? ratio : 0}%`,
                      minHeight: point.value > 0 ? 2 : 0,
                      opacity: point.value > 0 ? 1 : 0.18,
                      transitionDelay: `${Math.min(index, 12) * 30}ms`,
                    }}
                  />
                </div>
              </div>
              <span className={`bar-label ${showLabel ? '' : 'is-faint'}`}>
                {showLabel ? point.label : '·'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}