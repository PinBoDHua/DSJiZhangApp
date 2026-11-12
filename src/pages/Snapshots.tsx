import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, HardDrive, History, RotateCcw, Trash2 } from 'lucide-react';
import { SubPage } from '../components/SubPage';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Money, usePrivacy } from '../components/Money';
import { useStore } from '../store';
import type { AppState } from '../types';
import { formatDateTime } from '../lib/date';
import { formatHours, formatMoney } from '../lib/money';
import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_REASON_LABEL,
  deleteSnapshots,
  diffManifests,
  formatBytes,
  isSnapshotStoreAvailable,
  ledgerManifest,
  listSnapshots,
  readSnapshotState,
  saveSnapshot,
  snapshotTotalBytes,
  type SnapshotMeta,
} from '../lib/snapshots';

interface SnapshotsProps {
  onBack: () => void;
}

export function Snapshots({ onBack }: SnapshotsProps) {
  const { state, replaceState, toast } = useStore();
  const hiddenAmounts = usePrivacy();
  const [metas, setMetas] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState('');
  const [pendingRestore, setPendingRestore] = useState<{
    meta: SnapshotMeta;
    state: AppState;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SnapshotMeta | null>(null);
  const [busy, setBusy] = useState(false);
  // 确认框确认钮不随 busy 禁用，用 ref 挡住恢复 / 删除的连点重入。
  const actingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isSnapshotStoreAvailable()) {
      setAvailable(false);
      setLoading(false);
      return;
    }
    try {
      const list = await listSnapshots();
      setMetas(list);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取快照失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const takeSnapshot = async () => {
    setBusy(true);
    try {
      const saved = await saveSnapshot(state, 'manual');
      if (!saved) toast('内容和上一张快照一样，没有重复保存', 'info');
      else toast('已拍下本机快照', 'success');
      await refresh();
    } catch (snapshotError) {
      toast(snapshotError instanceof Error ? snapshotError.message : '拍快照失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const prepareRestore = async (meta: SnapshotMeta) => {
    setBusy(true);
    try {
      const snapshotState = await readSnapshotState(meta.id);
      setPendingRestore({ meta, state: snapshotState });
    } catch (restoreError) {
      toast(restoreError instanceof Error ? restoreError.message : '读取快照失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const restoreNow = async () => {
    if (!pendingRestore || actingRef.current) return;
    actingRef.current = true;
    const previous = state;
    setBusy(true);
    try {
      await saveSnapshot(previous, 'before-restore');
      // replaceState 会先落盘再切换：写入失败时必须明确失败，不能提示“已恢复”然后重启回滚。
      if (!replaceState(pendingRestore.state)) {
        toast('本机存储写入失败，操作未生效，请先导出备份', 'error');
        return;
      }
      toast(`已恢复到 ${formatDateTime(pendingRestore.meta.at)}`, 'success', {
        label: '撤销',
        onClick: () => {
          if (!replaceState(previous)) {
            toast('本机存储写入失败，操作未生效，请先导出备份', 'error');
          }
        },
      });
      setPendingRestore(null);
      await refresh();
    } catch (restoreError) {
      toast(restoreError instanceof Error ? restoreError.message : '恢复失败', 'error');
    } finally {
      actingRef.current = false;
      setBusy(false);
    }
  };

  const deleteNow = async () => {
    if (!pendingDelete || actingRef.current) return;
    actingRef.current = true;
    setBusy(true);
    try {
      await deleteSnapshots([pendingDelete.id]);
      setPendingDelete(null);
      toast('快照已删除', 'info');
      await refresh();
    } catch (deleteError) {
      toast(deleteError instanceof Error ? deleteError.message : '删除失败', 'error');
    } finally {
      actingRef.current = false;
      setBusy(false);
    }
  };

  const diff = pendingRestore
    ? diffManifests(ledgerManifest(state), ledgerManifest(pendingRestore.state))
    : [];

  return (
    <SubPage
      title="本机时光机"
      subtitle="发生在这台设备上的账本快照"
      onBack={onBack}
      action={
        <button
          type="button"
          className="btn btn--soft btn--sm"
          onClick={() => void takeSnapshot()}
          disabled={busy || !available}
        >
          <Camera size={15} />
          拍一张
        </button>
      }
    >
      <div className="snap-summary">
        <div>
          <span className="snap-summary-icon">
            <History size={18} />
          </span>
          <div>
            <strong>自动留底</strong>
            <p>
              空闲 3 分钟、每日首次打开和导入 / 清空前会自动拍快照；最多保留{' '}
              {metas.length > 0 ? `${metas.length} 个` : '30 个'}。
            </p>
          </div>
        </div>
        <div className="snap-usage">
          <HardDrive size={14} />
          {formatBytes(snapshotTotalBytes(metas))} / {formatBytes(SNAPSHOT_MAX_BYTES)}
        </div>
      </div>

      {!available ? (
        <EmptyState
          icon={History}
          title="本机快照不可用"
          description="当前环境不支持 IndexedDB（例如隐私模式），请用「导出备份」保护账本。"
        />
      ) : loading ? (
        <p className="snap-loading">正在读取快照…</p>
      ) : error ? (
        <p className="move-error">{error}</p>
      ) : metas.length === 0 ? (
        <EmptyState
          icon={History}
          title="还没有快照"
          description="记几笔后会自动留底。也可以现在手动拍一张，之后随时回到这个时间点。"
          actionLabel="现在拍一张"
          onAction={() => void takeSnapshot()}
        />
      ) : (
        <ul className="snap-list">
          {metas.map((meta) => (
            <li className="snap-item" key={meta.id}>
              <div className="snap-item-head">
                <strong>{formatDateTime(meta.at)}</strong>
                <span className={`snap-reason snap-reason--${meta.reason}`}>
                  {SNAPSHOT_REASON_LABEL[meta.reason]}
                </span>
              </div>
              <p className="snap-item-meta">
                {meta.manifest.entries} 笔工记 · {formatHours(meta.manifest.hours)}h · 工记合计{' '}
                <Money value={meta.manifest.entryTotal} /> · {formatBytes(meta.bytes)}
              </p>
              <div className="snap-item-actions">
                <button
                  type="button"
                  className="btn btn--soft btn--sm"
                  onClick={() => void prepareRestore(meta)}
                  disabled={busy}
                >
                  <RotateCcw size={14} />
                  恢复
                </button>
                <button
                  type="button"
                  className="btn btn--danger-text btn--sm"
                  onClick={() => setPendingDelete(meta)}
                  disabled={busy}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(pendingRestore)}
        title="回到这个时间点？"
        description={
          pendingRestore ? (
            <div className="snap-restore-desc">
              <p>
                将用 {formatDateTime(pendingRestore.meta.at)} 的账本覆盖当前状态；
                覆盖前会自动为当前状态拍一张快照。
              </p>
              <div className="snap-diff">
                {diff.map((row) => (
                  <div className="snap-diff-row" key={row.key}>
                    <span>{row.label}</span>
                    <span>
                      {formatDiff(row.before, row.unit, hiddenAmounts)} →{' '}
                      {formatDiff(row.after, row.unit, hiddenAmounts)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null
        }
        confirmLabel="恢复这份快照"
        onCancel={() => setPendingRestore(null)}
        onConfirm={() => void restoreNow()}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除这份快照？"
        description="删除后无法恢复；当前账本不受影响。"
        confirmLabel="删除快照"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void deleteNow()}
      />
    </SubPage>
  );
}

function formatDiff(
  value: number,
  unit: 'count' | 'hours' | 'money',
  hidden = false,
): string {
  if (unit === 'money') return hidden ? '¥••••' : `¥${formatMoney(value)}`;
  if (unit === 'hours') return `${formatHours(value)}h`;
  return String(value);
}
