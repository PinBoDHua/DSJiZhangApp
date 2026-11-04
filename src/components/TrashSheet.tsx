import { useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { formatDateShort } from '../lib/date';
import { jobColor } from '../lib/meta';
import { TRASH_RETENTION_DAYS, trashRemainingDays } from '../lib/trash';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { Sheet } from './Sheet';

interface TrashSheetProps {
  open: boolean;
  onClose: () => void;
}

export function TrashSheet({ open, onClose }: TrashSheetProps) {
  const { state, restoreJob, purgeJob, toast } = useStore();
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const target = state.trashedJobs.find((item) => item.job.id === purgeId);

  const restore = (jobId: string) => {
    if (restoreJob(jobId)) toast('工作已恢复');
    else toast('恢复失败，请稍后再试', 'error');
  };

  const purge = () => {
    if (!purgeId) return;
    const ok = purgeJob(purgeId);
    setPurgeId(null);
    toast(ok ? '工作已彻底删除' : '删除失败，请稍后再试', ok ? 'info' : 'error');
  };

  return (
    <>
      <Sheet
        open={open}
        title="工作回收站"
        subtitle="删除的空工作会先放这里，可以恢复或彻底删除"
        onClose={onClose}
      >
        <div className="sheet-body">
          {state.trashedJobs.length > 0 ? (
            <div className="trash-list">
              {state.trashedJobs.map((item) => (
                <div className="trash-row" key={item.job.id}>
                  <span
                    className="trash-dot"
                    style={{ background: jobColor(item.job.color).main }}
                  />
                  <span className="trash-copy">
                    <strong>{item.job.name}</strong>
                    <em>
                      {item.job.employer ? `${item.job.employer} · ` : ''}
                      删除于 {formatDateShort(item.deletedAt.slice(0, 10))} · 还剩{' '}
                      {trashRemainingDays(item.deletedAt)} 天
                    </em>
                  </span>
                  <button
                    type="button"
                    className="icon-button icon-button--small"
                    onClick={() => restore(item.job.id)}
                    aria-label={`恢复 ${item.job.name}`}
                    title="恢复"
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    type="button"
                    className="icon-button icon-button--small trash-delete"
                    onClick={() => setPurgeId(item.job.id)}
                    aria-label={`彻底删除 ${item.job.name}`}
                    title="彻底删除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Trash2}
              title="回收站是空的"
              description="删除没有记录的空工作后，会先出现在这里。"
              compact
            />
          )}
          <p className="calc-note">
            有工记、借支或结算记录的工作不能删除，只能归档；归档可在工作管理里恢复。
            回收站里的工作超过 {TRASH_RETENTION_DAYS} 天会自动清理。
          </p>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(target)}
        title="彻底删除这份工作？"
        description="彻底删除后无法恢复。"
        confirmLabel="彻底删除"
        danger
        onCancel={() => setPurgeId(null)}
        onConfirm={purge}
      />
    </>
  );
}
