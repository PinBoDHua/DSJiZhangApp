import { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  Camera,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FileText,
  HardDrive,
  History,
  ShieldCheck,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import { SubPage } from '../components/SubPage';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { MoveSheet } from '../components/MoveSheet';
import { useStore } from '../store';
import { todayISO } from '../lib/date';
import { formatHours } from '../lib/money';
import { backupFileName, buildExportPayload } from '../lib/storage';
import { getLastBackupAt, markBackedUp } from '../lib/backupStatus';
import { buildEntryCsv, buildSettlementCsv } from '../lib/csv';
import { buildLedgerXlsx, excelFileName } from '../lib/excel';
import { xlsxBlob } from '../lib/xlsx';
import { isNativeApp, saveBlobFile, saveTextFile } from '../lib/native';
import {
  readAutoBackupSettings,
  runAutoBackup,
  writeAutoBackupSettings,
  type AutoBackupSettings,
} from '../lib/autoBackup';
import {
  formatBytes,
  listSnapshots,
  saveSnapshot,
  snapshotTotalBytes,
  type SnapshotMeta,
} from '../lib/snapshots';
import { checkLedger, healthBadgeText, type HealthReport } from '../lib/health';

interface DataSafetyProps {
  onBack: () => void;
  onOpenSnapshots: () => void;
  onOpenHealth: () => void;
  onOpenPrivacy: () => void;
}

export function DataSafety({
  onBack,
  onOpenSnapshots,
  onOpenHealth,
  onOpenPrivacy,
}: DataSafetyProps) {
  const { state, resetAll, toast } = useStore();
  const [backupAt, setBackupAt] = useState<string | null>(() => getLastBackupAt());
  const [auto, setAuto] = useState<AutoBackupSettings>(() => readAutoBackupSettings());
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveMode, setMoveMode] = useState<'export' | 'import'>('export');
  const [clearOpen, setClearOpen] = useState(false);
  const native = isNativeApp();

  const refresh = useCallback(async () => {
    setBackupAt(getLastBackupAt());
    setAuto(readAutoBackupSettings());
    setReport(checkLedger(state, { lastBackupAt: getLastBackupAt() }));
    try {
      setSnapshots(await listSnapshots());
    } catch {
      setSnapshots([]);
    }
  }, [state]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const quickBackup = async () => {
    setBusy(true);
    try {
      const result = await saveTextFile(
        backupFileName(),
        buildExportPayload(state),
      );
      markBackedUp();
      setBackupAt(getLastBackupAt());
      toast(result === 'native' ? '备份已保存到「下载/Xinshi」' : '备份已导出', 'success');
    } catch {
      toast('备份失败，请稍后再试', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoBackup = async () => {
    const next = !auto.enabled;
    if (next && !native) {
      toast('网页版不能自动写下载目录，请手动备份', 'info');
      return;
    }
    const saved = writeAutoBackupSettings({ enabled: next, lastError: undefined });
    setAuto(saved);
    if (!next) {
      toast('自动备份已关闭', 'info');
      return;
    }
    setBusy(true);
    try {
      const result = await runAutoBackup(state);
      setAuto(readAutoBackupSettings());
      setBackupAt(getLastBackupAt());
      if (result.error) toast(`自动备份失败：${result.error}`, 'error');
      else toast(`自动备份已开启${result.path ? `，已写入 ${result.path}` : ''}`, 'success');
    } finally {
      setBusy(false);
    }
  };

  const takeSnapshot = async () => {
    setBusy(true);
    try {
      const saved = await saveSnapshot(state, 'manual');
      toast(saved ? '已拍下本机快照' : '内容和上一张快照一样', saved ? 'success' : 'info');
      setSnapshots(await listSnapshots());
    } catch (error) {
      toast(error instanceof Error ? error.message : '拍快照失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = async () => {
    setBusy(true);
    try {
      const data = await buildLedgerXlsx(state);
      await saveBlobFile(xlsxBlob(data), excelFileName());
      toast('Excel 对账表已导出', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Excel 导出失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportEntryCsv = async () => {
    setBusy(true);
    try {
      const result = await saveTextFile(
        `薪时完整工记-${todayISO()}.csv`,
        buildEntryCsv(state.entries, state.jobs),
        'text/csv;charset=utf-8',
      );
      toast(
        result === 'native'
          ? '完整工记 CSV 已保存到「下载/Xinshi」'
          : '完整工记 CSV 已导出',
        'success',
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : '工记 CSV 导出失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const exportSettlementCsv = async () => {
    setBusy(true);
    try {
      await saveTextFile(
        `薪时结算流水-${todayISO()}.csv`,
        buildSettlementCsv(state.settlements),
        'text/csv;charset=utf-8',
      );
      toast('结算流水 CSV 已导出', 'success');
    } catch {
      toast('CSV 导出失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (busy) return;
    setClearOpen(false);
    setBusy(true);
    try {
      await saveSnapshot(state, 'before-clear');
      resetAll();
      toast('数据已清空，可在本机时光机找回清空前快照', 'info');
      await refresh();
    } catch (error) {
      toast(
        error instanceof Error
          ? `清空前快照失败，已取消清空：${error.message}`
          : '清空前快照失败，已取消清空',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  const snapshotBytes = snapshotTotalBytes(snapshots);
  const backupText = backupAt
    ? `上次离机备份：${new Date(backupAt).toLocaleDateString('zh-CN')}`
    : '还没有离机备份';
  const healthText = report ? healthBadgeText(report) : '检查中…';

  return (
    <SubPage title="数据与安全" subtitle="账本只在本机，底要自己留" onBack={onBack}>
      <div className="safety-hero">
        <div className="safety-hero-head">
          <span className="safety-hero-icon">
            <ShieldCheck size={22} />
          </span>
          <div>
            <strong>{backupText}</strong>
            <p>{backupAt ? '换手机或清缓存前，再导出一份搬家包更稳。' : '先导出一份，换手机不慌。'}</p>
          </div>
        </div>
        <div className="safety-metrics">
          <div>
            <span>本机快照</span>
            <strong>
              {snapshots.length} 个 · {formatBytes(snapshotBytes)}
            </strong>
          </div>
          <div>
            <span>账本体检</span>
            <strong>{healthText}</strong>
          </div>
        </div>
        <div className="safety-actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void quickBackup()} disabled={busy}>
            <Download size={15} />
            立即备份
          </button>
          <button
            type="button"
            className="btn btn--soft btn--sm"
            onClick={() => {
              setMoveMode('export');
              setMoveOpen(true);
            }}
            disabled={busy}
          >
            <Smartphone size={15} />
            搬家
          </button>
          <button type="button" className="btn btn--soft btn--sm" onClick={onOpenHealth} disabled={busy}>
            <ShieldCheck size={15} />
            体检
          </button>
        </div>
      </div>

      <section className="settings-group">
        <h2>备份与迁移</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-icon">
              <HardDrive size={18} />
            </span>
            <span className="settings-body">
              <strong>自动备份（Android）</strong>
              <em>
                {native
                  ? `每天首次打开 App 写入 Download/Xinshi/自动备份，保留 ${auto.keep} 份`
                  : '网页版不能自动写下载目录，请用「立即备份」'}
              </em>
              {auto.lastRunAt ? (
                <em>上次自动：{new Date(auto.lastRunAt).toLocaleString('zh-CN')}</em>
              ) : null}
              {auto.lastError ? <em className="safety-error">上次失败：{auto.lastError}</em> : null}
            </span>
            <button
              type="button"
              className={`switch ${auto.enabled ? 'is-on' : ''}`}
              role="switch"
              aria-checked={auto.enabled}
              aria-label="自动备份"
              onClick={() => void toggleAutoBackup()}
              disabled={busy || !native}
            >
              <i />
            </button>
          </div>
          <button type="button" className="settings-row" onClick={() => void quickBackup()} disabled={busy}>
            <span className="settings-icon">
              <Download size={18} />
            </span>
            <span className="settings-body">
              <strong>立即导出备份</strong>
              <em>普通 JSON，换机恢复最省事；需要保密用搬家包</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
          <button
            type="button"
            className="settings-row"
            onClick={() => {
              setMoveMode('export');
              setMoveOpen(true);
            }}
          >
            <span className="settings-icon">
              <Smartphone size={18} />
            </span>
            <span className="settings-body">
              <strong>搬家到新手机</strong>
              <em>带校验码的完整账本，可设密码；导入前先看差异</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
          <button
            type="button"
            className="settings-row"
            onClick={() => {
              setMoveMode('import');
              setMoveOpen(true);
            }}
          >
            <span className="settings-icon">
              <Upload size={18} />
            </span>
            <span className="settings-body">
              <strong>导入搬家包 / 备份</strong>
              <em>支持新搬家包、普通备份和旧版加密备份</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
        </div>
        <p className="settings-note">
          <ShieldCheck size={14} />
          自动备份默认关闭；开启后写的是明文 JSON，能读手机文件的应用可能看到内容。需要保密请用加密搬家包。
        </p>
      </section>

      <section className="settings-group">
        <h2>本机时光机</h2>
        <div className="settings-card">
          <button type="button" className="settings-row" onClick={onOpenSnapshots}>
            <span className="settings-icon">
              <History size={18} />
            </span>
            <span className="settings-body">
              <strong>查看本机快照</strong>
              <em>
                {snapshots.length > 0
                  ? `${snapshots.length} 个快照 · ${formatBytes(snapshotBytes)}，可恢复或删除`
                  : '记几笔后会自动留底，也可手动拍一张'}
              </em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
          <button type="button" className="settings-row" onClick={() => void takeSnapshot()} disabled={busy}>
            <span className="settings-icon">
              <Camera size={18} />
            </span>
            <span className="settings-body">
              <strong>现在拍一张</strong>
              <em>记录当前账本状态，误操作后可回到这里</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
        </div>
        <p className="settings-note">
          <ShieldCheck size={14} />
          快照只在本机，卸载 App 或清站点数据会一起消失，不能替代离机备份。
        </p>
      </section>

      <section className="settings-group">
        <h2>对账导出</h2>
        <div className="settings-card">
          <button type="button" className="settings-row" onClick={() => void exportEntryCsv()} disabled={busy}>
            <span className="settings-icon"><FileText size={18} /></span>
            <span className="settings-body">
              <strong>完整工记 CSV</strong>
              <em>全部有效工记 + 完整计薪快照；不含照片本体，不能代替备份</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
          <button type="button" className="settings-row" onClick={() => void exportExcel()} disabled={busy}>
            <span className="settings-icon">
              <FileSpreadsheet size={18} />
            </span>
            <span className="settings-body">
              <strong>Excel 对账表</strong>
              <em>工记明细 / 月度汇总 / 结算单 / 借支四张表</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
          <button
            type="button"
            className="settings-row"
            onClick={() => void exportSettlementCsv()}
            disabled={busy}
          >
            <span className="settings-icon">
              <FileText size={18} />
            </span>
            <span className="settings-body">
              <strong>结算流水 CSV</strong>
              <em>全部结算单，可直接发给老板或自己存档</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2>隐私与合规</h2>
        <div className="settings-card">
          <button type="button" className="settings-row" onClick={onOpenPrivacy}>
            <span className="settings-icon">
              <ShieldCheck size={18} />
            </span>
            <span className="settings-body">
              <strong>隐私政策</strong>
              <em>不收集、不上传；说明权限、导出与删除方式</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
        </div>
        <p className="settings-note">
          <ShieldCheck size={14} />
          本应用不登录、无广告、无统计 SDK；Android 版不申请网络权限。
        </p>
        <p className="settings-note">
          <ShieldCheck size={14} />
          考勤照片只存本机，不上传，也不随备份 / 搬家包 / 本机快照迁移。
        </p>
      </section>

      <section className="settings-group">
        <h2>危险区</h2>
        <div className="settings-card">
          <button
            type="button"
            className="settings-row settings-row--danger"
            onClick={() => setClearOpen(true)}
            disabled={busy}
          >
            <span className="settings-icon">
              <Trash2 size={18} />
            </span>
            <span className="settings-body">
              <strong>清空所有数据</strong>
              <em>会删除工作、工记、休息、借支、结算和考勤照片；清空前自动拍快照</em>
            </span>
            <ArrowRight size={16} className="settings-chevron" />
          </button>
        </div>
      </section>

      <p className="profile-footer">
        当前账本：{state.jobs.length} 份工作 · {state.entries.length} 笔工记 ·{' '}
        {formatHours(state.entries.reduce((sum, entry) => sum + (entry.hours || 0), 0))}h
        <br />
        数据只存在这台设备，不上传服务器
      </p>

      <MoveSheet
        open={moveOpen}
        mode={moveMode}
        onClose={() => {
          setMoveOpen(false);
          void refresh();
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        title="清空所有数据？"
        description="工作、工记、休息、借支和结算会全部删除，考勤照片也会一起清理。清空前会自动存一张本机快照；快照不含照片。"
        confirmLabel="全部清空"
        danger
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void clearAll()}
      />
    </SubPage>
  );
}
