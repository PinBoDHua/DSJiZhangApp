import { useEffect, useMemo, useState } from 'react';
import { Camera, RotateCcw, Trash2 } from 'lucide-react';
import type { Job, TrashKind } from '../types';
import { useStore } from '../store';
import { formatDateShort } from '../lib/date';
import { jobColor } from '../lib/meta';
import { formatHours } from '../lib/money';
import {
  TRASH_CAP_PER_KIND,
  TRASH_RETENTION_DAYS,
  buildTrashRows,
  filterTrashRows,
  summarizeTrash,
  trashKindLabel,
  trashRestoreBlockReason,
  type TrashRow,
} from '../lib/trash';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { Money } from './Money';
import { Sheet } from './Sheet';

type Filter = 'all' | TrashKind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'entry', label: '工记' },
  { key: 'rest', label: '休息' },
  { key: 'advance', label: '借支' },
  { key: 'job', label: '工作' },
];

interface TrashSheetProps {
  open: boolean;
  onClose: () => void;
}

export function TrashSheet({ open, onClose }: TrashSheetProps) {
  const { state, restoreTrashItem, purgeTrashItem, emptyTrash, toast } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [jobFilter, setJobFilter] = useState<'all' | string>('all');
  const [target, setTarget] = useState<{ kind: TrashKind; id: string } | null>(null);
  const [emptyOpen, setEmptyOpen] = useState(false);

  const rows = useMemo(() => buildTrashRows(state), [state]);
  const visible = useMemo(
    () => filterTrashRows(rows, filter, jobFilter),
    [rows, filter, jobFilter],
  );
  const summary = useMemo(() => summarizeTrash(visible), [visible]);
  const counts = useMemo(() => {
    const next: Record<TrashKind, number> = { job: 0, entry: 0, rest: 0, advance: 0 };
    const scoped = jobFilter === 'all' ? rows : filterTrashRows(rows, 'all', jobFilter);
    for (const row of scoped) next[row.kind] += 1;
    return next;
  }, [rows, jobFilter]);
  const jobMap = useMemo(() => {
    const map = new Map<string, Job>();
    for (const job of state.jobs) map.set(job.id, job);
    for (const item of state.trashedJobs) map.set(item.job.id, item.job);
    return map;
  }, [state.jobs, state.trashedJobs]);

  const jobOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const row of rows) {
      if (!row.jobId) continue;
      if (filter !== 'all' && row.kind !== filter) continue;
      const existing = map.get(row.jobId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      map.set(row.jobId, {
        id: row.jobId,
        name: jobMap.get(row.jobId)?.name ?? '已删除的工作',
        count: 1,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }, [rows, jobMap, filter]);

  useEffect(() => {
    if (jobFilter === 'all') return;
    const stillVisible = rows.some(
      (row) => row.jobId === jobFilter && (filter === 'all' || row.kind === filter),
    );
    if (!stillVisible) setJobFilter('all');
  }, [filter, jobFilter, rows]);

  const targetRow = target
    ? rows.find((row) => row.kind === target.kind && row.id === target.id)
    : undefined;
  const targetLabel = target ? trashKindLabel(target.kind) : '记录';

  const colorOf = (jobId: string | null): string => {
    const job = jobId ? jobMap.get(jobId) : undefined;
    return job ? jobColor(job.color).main : 'var(--muted-2)';
  };

  const handleRestore = (row: TrashRow) => {
    const result = restoreTrashItem(row.kind, row.id);
    if (result.ok) {
      toast(`${trashKindLabel(row.kind)}已恢复`);
      return;
    }
    toast(result.reason ?? '恢复失败，请稍后再试', 'error');
  };

  const handlePurge = () => {
    if (!target) return;
    const ok = purgeTrashItem(target.kind, target.id);
    setTarget(null);
    toast(
      ok ? `${trashKindLabel(target.kind)}已彻底删除` : '删除失败，请稍后再试',
      ok ? 'info' : 'error',
    );
  };

  const handleEmpty = () => {
    const count = emptyTrash();
    setEmptyOpen(false);
    toast(
      count > 0 ? `回收站已清空，${count} 条记录已彻底删除` : '回收站已经是空的',
      count > 0 ? 'info' : 'success',
    );
  };

  return (
    <>
      <Sheet
        open={open}
        title="回收站"
        subtitle={`删除的工记、休息、借支和工作先放这里，${TRASH_RETENTION_DAYS} 天内可恢复`}
        onClose={onClose}
      >
        <div className="sheet-body">
          {rows.length > 0 ? (
            <>
              <div className="filter-row trash-filters">
                {FILTERS.map((item) => {
                  const count = item.key === 'all' ? counts.job + counts.entry + counts.rest + counts.advance : counts[item.key];
                  return (
                    <button
                      type="button"
                      key={item.key}
                      className={`filter-chip ${filter === item.key ? 'is-active' : ''}`}
                      onClick={() => setFilter(item.key)}
                      aria-pressed={filter === item.key}
                    >
                      {item.label}
                      <span>{count}</span>
                    </button>
                  );
                })}
              </div>

              {jobOptions.length >= 2 ? (
                <div className="filter-row trash-job-filters">
                  <button
                    type="button"
                    className={`filter-chip ${jobFilter === 'all' ? 'is-active' : ''}`}
                    onClick={() => setJobFilter('all')}
                    aria-pressed={jobFilter === 'all'}
                  >
                    全部工作
                  </button>
                  {jobOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className={`filter-chip ${jobFilter === option.id ? 'is-active' : ''}`}
                      onClick={() => setJobFilter(option.id)}
                      aria-pressed={jobFilter === option.id}
                    >
                      {option.name}
                      <span>{option.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="trash-summary">
                <span>{summary.count} 条待处理</span>
                {summary.amount > 0 ? (
                  <span>
                    金额 <Money value={summary.amount} />
                  </span>
                ) : null}
                {summary.hours > 0 ? <span>{formatHours(summary.hours)} 小时</span> : null}
                {summary.restDays > 0 ? (
                  <span>{formatHours(summary.restDays)} 天休息</span>
                ) : null}
              </div>

              {visible.length > 0 ? (
                <div className="trash-list">
                  {visible.map((row) => {
                    const blockReason = trashRestoreBlockReason(row, state);
                    return (
                      <div className="trash-row" key={row.key}>
                        <span
                          className="trash-dot"
                          style={{ background: colorOf(row.jobId) }}
                          aria-hidden="true"
                        />
                        <span className="trash-copy">
                          <span className="trash-title-line">
                            <span className={`trash-kind trash-kind--${row.kind}`}>
                              {trashKindLabel(row.kind)}
                            </span>
                            <strong>{row.title}</strong>
                            {row.hasPhoto ? (
                              <Camera
                                size={12}
                                className="trash-photo"
                                aria-label="有考勤照片"
                              />
                            ) : null}
                            {row.amount !== null ? (
                              <Money value={row.amount} className="trash-amount" />
                            ) : null}
                          </span>
                          <em>{row.subtitle}</em>
                          <span className="trash-meta">
                            删除于 {formatDateShort(row.deletedAt.slice(0, 10))}
                            {row.remainingDays > 0
                              ? ` · 还剩 ${row.remainingDays} 天`
                              : ' · 今天会自动清理'}
                          </span>
                          {blockReason ? <span className="trash-block">{blockReason}</span> : null}
                        </span>
                        <button
                          type="button"
                          className="icon-button icon-button--small"
                          onClick={() => handleRestore(row)}
                          disabled={Boolean(blockReason)}
                          aria-label={`恢复 ${row.title} · ${trashKindLabel(row.kind)}`}
                          title={blockReason ?? '恢复'}
                        >
                          <RotateCcw size={15} />
                        </button>
                        <button
                          type="button"
                          className="icon-button icon-button--small trash-delete"
                          onClick={() => setTarget({ kind: row.kind, id: row.id })}
                          aria-label={`彻底删除 ${row.title} · ${trashKindLabel(row.kind)}`}
                          title="彻底删除"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={Trash2}
                  title="这个筛选下没有记录"
                  description="换一个工作或类型看看。"
                  compact
                />
              )}

              <button
                type="button"
                className="btn btn--ghost btn--block trash-clear"
                onClick={() => setEmptyOpen(true)}
              >
                清空回收站 · {rows.length} 条
              </button>
            </>
          ) : (
            <EmptyState
              icon={Trash2}
              title="回收站是空的"
              description={`删除的工记、休息、借支或工作会先放这里，${TRASH_RETENTION_DAYS} 天内可以恢复。`}
              compact
            />
          )}
          <p className="calc-note">
            超过 {TRASH_RETENTION_DAYS} 天会自动清理，每类最多保留 {TRASH_CAP_PER_KIND} 条；
            已结算的记录不能删除，需要先撤销结算。有工记、借支、休息或结算的工作只能归档。
          </p>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(targetRow)}
        title={`彻底删除这条${targetLabel}？`}
        description="彻底删除后无法恢复；如果只是想暂时隐藏，可以保留到自动清理。"
        confirmLabel="彻底删除"
        danger
        onCancel={() => setTarget(null)}
        onConfirm={handlePurge}
      />

      <ConfirmDialog
        open={emptyOpen}
        title="清空回收站？"
        description={`回收站里的 ${rows.length} 条记录会被永久删除，无法恢复。`}
        confirmLabel="全部删除"
        danger
        onCancel={() => setEmptyOpen(false)}
        onConfirm={handleEmpty}
      />
    </>
  );
}
