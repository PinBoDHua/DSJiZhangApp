import { useEffect, useMemo, useState } from 'react';
import { Search as SearchIcon, SearchX, X } from 'lucide-react';
import { useStore } from '../store';
import { EntryRow } from '../components/EntryRow';
import { EmptyState } from '../components/EmptyState';
import { JobDot } from '../components/JobDot';
import { Money } from '../components/Money';
import { SubPage } from '../components/SubPage';
import {
  formatDateShort,
  relativeDayLabel,
  todayISO,
  weekdayCN,
} from '../lib/date';
import { formatHours } from '../lib/money';
import { searchEntries, tokenizeQuery } from '../lib/search';
import { sumEntries } from '../lib/settlement';
import { settledEntryIds } from '../lib/pagePay';

interface SearchProps {
  onBack: () => void;
  onOpenEntry: (entryId: string) => void;
}

// 千条级账本下宽泛搜索可能命中很多：先渲染前 100 条，其余点「查看更多」（UI-09 轻量保护）。
const SEARCH_PAGE_SIZE = 100;

export function Search({ onBack, onOpenEntry }: SearchProps) {
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [jobId, setJobId] = useState('all');
  const [limit, setLimit] = useState(SEARCH_PAGE_SIZE);
  const terms = tokenizeQuery(query);
  const jobsWithEntries = useMemo(
    () => state.jobs.filter((job) => state.entries.some((entry) => entry.jobId === job.id)),
    [state.jobs, state.entries],
  );
  // PAY-27：已结算判定与 Excel / 汇总同口径，取结算单 entryIds 并集。
  const settledIds = useMemo(
    () => settledEntryIds(state.settlements),
    [state.settlements],
  );
  const results = useMemo(
    () =>
      searchEntries(state.entries, state.jobs, query, {
        jobId: jobId === 'all' ? undefined : jobId,
        settledEntryIds: settledIds,
      }),
    [state.entries, state.jobs, query, jobId, settledIds],
  );
  const totals = useMemo(
    () => sumEntries(results.map((result) => result.entry)),
    [results],
  );
  // 查询 / 岗位变化时回到第一页。
  useEffect(() => {
    setLimit(SEARCH_PAGE_SIZE);
  }, [query, jobId]);
  const groups = useMemo(() => {
    const map = new Map<string, typeof results>();
    for (const result of results.slice(0, limit)) {
      const list = map.get(result.entry.date);
      if (list) list.push(result);
      else map.set(result.entry.date, [result]);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [results, limit]);
  const quickDates = useMemo(() => {
    const dates = Array.from(new Set([todayISO(), ...state.entries.map((entry) => entry.date)]))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 2);
    return dates;
  }, [state.entries]);
  const quickWords = Array.from(
    new Set(
      jobsWithEntries
        .slice(0, 3)
        .map((job) => job.name)
        .filter(Boolean),
    ),
  );

  return (
    <SubPage
      title="搜索工记"
      subtitle={`全部 ${state.entries.length} 笔工记，按岗位、备注、日期或金额找`}
      onBack={onBack}
    >
      <div className="search-bar" role="search">
        <SearchIcon size={17} className="search-bar-icon" aria-hidden="true" />
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜岗位、备注、日期或金额"
          aria-label="搜索工记"
          enterKeyHint="search"
          autoFocus
        />
        {query ? (
          <button
            type="button"
            className="search-clear"
            onClick={() => setQuery('')}
            aria-label="清空搜索"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {jobsWithEntries.length > 1 ? (
        <div className="filter-row" aria-label="按工作筛选">
          <button
            type="button"
            className={`filter-chip ${jobId === 'all' ? 'is-active' : ''}`}
            onClick={() => setJobId('all')}
            aria-pressed={jobId === 'all'}
          >
            全部
          </button>
          {jobsWithEntries.map((job) => (
            <button
              type="button"
              key={job.id}
              className={`filter-chip ${jobId === job.id ? 'is-active' : ''}`}
              onClick={() => setJobId(job.id)}
              aria-pressed={jobId === job.id}
            >
              <JobDot color={job.color} size={7} />
              {job.name}
            </button>
          ))}
        </div>
      ) : null}

      {terms.length === 0 ? (
        <div className="card search-guide">
          <h2>试试点什么</h2>
          <p>可以搜岗位名、备注里的词、日期，或者一笔工钱的数字。</p>
          <div className="search-examples">
            {quickWords.map((word) => (
              <button
                type="button"
                key={word}
                className="filter-chip"
                onClick={() => setQuery(word)}
              >
                {word}
              </button>
            ))}
            {quickDates.map((date) => (
              <button
                type="button"
                key={date}
                className="filter-chip"
                onClick={() => setQuery(date)}
              >
                {formatDateShort(date)}
              </button>
            ))}
            <button type="button" className="filter-chip" onClick={() => setQuery('加班')}>
              加班
            </button>
            <button type="button" className="filter-chip" onClick={() => setQuery('已结算')}>
              已结算
            </button>
          </div>
          <p className="search-tip">
            多个关键词用空格分开，例如「顺丰 夜班」，会同时匹配岗位和备注。
          </p>
        </div>
      ) : null}

      {terms.length > 0 && results.length === 0 ? (
        <div className="card empty-card">
          <EmptyState
            icon={SearchX}
            title="没有找到这笔工记"
            description="换个关键词试试：岗位名、备注里的词、11-06 这样的日期，或工钱数字。"
          />
        </div>
      ) : null}

      {results.length > 0 ? (
        <>
          <section className="search-summary" aria-live="polite">
            <div>
              <strong>{results.length}</strong>
              <span>笔命中</span>
            </div>
            <div>
              <span>折算合计</span>
              <Money value={totals.total} />
            </div>
            <div>
              <span>合计工时</span>
              <strong>{formatHours(totals.hours)}h</strong>
            </div>
          </section>
          {results.length > limit ? (
            <p className="search-tip" aria-live="polite">
              命中 {results.length} 笔，先显示前 {limit} 笔；点下方「查看更多」继续。
            </p>
          ) : null}
          <div className="record-groups">
            {groups.map(([date, dayResults]) => {
              const dayTotals = sumEntries(dayResults.map((result) => result.entry));
              const relative = relativeDayLabel(date);
              return (
                <section className="record-group" key={date}>
                  <div className="record-day-head">
                    <div>
                      <h2>
                        {formatDateShort(date)}
                        <span>{weekdayCN(date)}</span>
                        {relative ? <em className="micro-badge">{relative}</em> : null}
                      </h2>
                      <p>
                        {dayResults.length} 笔 · {formatHours(dayTotals.hours)}h
                      </p>
                    </div>
                    <div className="record-day-total">
                      <Money value={dayTotals.total} />
                    </div>
                  </div>
                  <div className="card list-card">
                    {dayResults.map((result) => (
                      <EntryRow
                        key={result.entry.id}
                        entry={result.entry}
                        job={result.job}
                        showNote
                        onClick={() => onOpenEntry(result.entry.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          {results.length > limit ? (
            <button
              type="button"
              className="btn btn--soft btn--block"
              onClick={() => setLimit((current) => current + SEARCH_PAGE_SIZE)}
            >
              查看更多（还有 {results.length - limit} 笔）
            </button>
          ) : null}
          <p className="stats-footnote">
            折算合计按每笔工记的规则计算；固定月薪的实际发放以结算页为准。
          </p>
        </>
      ) : null}
    </SubPage>
  );
}
