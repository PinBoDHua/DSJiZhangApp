import type { Entry, Job, RestDay, WeekStart } from '../types';
import {
  addDays,
  daysInMonth,
  parseISODate,
  startOfWeek,
  todayISO,
  weekdayCN,
} from '../lib/date';
import { formatCompactMoney } from '../lib/money';
import { formatRestDays, totalRestDays } from '../lib/rest';
import { sumEntries } from '../lib/settlement';
import { jobColor } from '../lib/meta';
import { usePrivacy } from './Money';

interface MonthCalendarProps {
  monthStart: string;
  entries: Entry[];
  restDays?: RestDay[];
  plannedWorkDates?: string[];
  jobs: Job[];
  weekStartsOn: WeekStart;
  selectedDate: string;
  onSelect: (date: string) => void;
}

export function MonthCalendar({
  monthStart,
  entries,
  restDays = [],
  plannedWorkDates = [],
  jobs,
  weekStartsOn,
  selectedDate,
  onSelect,
}: MonthCalendarProps) {
  const gridStart = startOfWeek(monthStart, weekStartsOn);
  const totalDays = daysInMonth(monthStart);
  const offset = (parseISODate(monthStart).getDay() - weekStartsOn + 7) % 7;
  const cellsNeeded = Math.ceil((offset + totalDays) / 7) * 7;
  const today = todayISO();
  // 金额隐私：日历按钮的读屏文案也不应读出当天合计金额。
  const hideAmounts = usePrivacy();
  const byDate = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.date);
    if (list) list.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  const restByDate = new Map<string, RestDay[]>();
  for (const rest of restDays) {
    const list = restByDate.get(rest.date);
    if (list) list.push(rest);
    else restByDate.set(rest.date, [rest]);
  }
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const plannedSet = new Set(plannedWorkDates);

  return (
    <div className="calendar">
      <div className="calendar-weekdays" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index}>{weekdayCN(addDays(gridStart, index)).replace('周', '')}</span>
        ))}
      </div>
      <div className="calendar-grid" role="group" aria-label="工记日历">
        {Array.from({ length: cellsNeeded }, (_, index) => {
          const date = addDays(gridStart, index);
          const day = Number(date.slice(8));
          const inMonth = date.slice(0, 7) === monthStart.slice(0, 7);
          if (!inMonth) {
            return <span className="cal-day is-out" key={date} aria-hidden="true" />;
          }
          const dayEntries = byDate.get(date) ?? [];
          const dayRest = restByDate.get(date) ?? [];
          const dayRestTotal = totalRestDays(dayRest);
          const plannedWork = plannedSet.has(date) && dayRest.length === 0;
          const totals = dayEntries.length > 0 ? sumEntries(dayEntries) : null;
          const colors = Array.from(
            new Set(
              dayEntries.map((entry) => jobMap.get(entry.jobId)?.color ?? 'pine'),
            ),
          ).slice(0, 3);
          const selected = date === selectedDate;
          return (
            <button
              type="button"
              key={date}
              className={[
                'cal-day',
                dayEntries.length > 0 ? 'has-entry' : '',
                dayRest.length > 0 ? 'has-rest' : '',
                plannedWork ? 'has-plan' : '',
                date === today ? 'is-today' : '',
                selected ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(date)}
              aria-pressed={selected}
              aria-label={`${date}，${dayEntries.length} 笔工记${
                dayRestTotal > 0
                  ? `，休息 ${formatRestDays(dayRestTotal)} 天`
                  : ''
              }${plannedWork ? '，计划上班' : ''}${
                totals && !hideAmounts
                  ? `，${formatCompactMoney(totals.total)} 元`
                  : totals
                    ? '，金额已隐藏'
                    : ''
              }`}
            >
              <span className="cal-day-num">{day}</span>
              {dayRestTotal > 0 ? (
                <span className="cal-rest-flag">
                  {dayRestTotal === 0.5 ? '半' : '休'}
                </span>
              ) : null}
              {plannedWork ? <span className="cal-plan-flag">班</span> : null}
              <span className="cal-dots">
                {colors.map((colorKey) => (
                  <i
                    key={colorKey}
                    className="cal-dot"
                    style={{ background: jobColor(colorKey).main }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
