import { useRef, useState } from 'react';
import { AlertTriangle, Download, RefreshCw, ShieldAlert, Upload } from 'lucide-react';
import type { AppState } from '../types';
import type { LoadStateFailure } from '../lib/storage';
import { saveState, validateImport } from '../lib/storage';
import { saveTextFile } from '../lib/native';
import { decryptBackup, isEncryptedBackup } from '../lib/backup';
import { Logo } from './Logo';

const RAW_FILE_NAME = '薪时原始账本-待恢复.txt';
/** 与导入页同一口径：file.text() + JSON.parse 的峰值远大于文件本身。 */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

interface StorageRecoveryProps {
  failure: LoadStateFailure;
  /** 仅“存储不可访问”时提供：允许用户以内存账本继续，不被锁死在恢复页。 */
  onContinue?: () => void;
}

export function StorageRecovery({ failure, onContinue }: StorageRecoveryProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const unavailable = failure.kind === 'unavailable';

  // 原生壳里的 <a download> 不会触发系统下载，必须走 SaveFile 插件才能真的落盘。
  const exportRaw = async () => {
    if (!failure.raw) return;
    const result = await saveTextFile(RAW_FILE_NAME, failure.raw, 'text/plain;charset=utf-8');
    setStatus(
      result === 'native'
        ? `已保存到「下载/Xinshi/${RAW_FILE_NAME}」`
        : '已开始下载原始账本，请确认文件保存成功',
    );
  };

  const exportRawManually = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      await exportRaw();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `导出失败：${error.message}。请勿清除站点数据，联系开发者处理。`
          : '导出失败，请勿清除站点数据，联系开发者处理。',
      );
    } finally {
      setBusy(false);
    }
  };

  const applyRestoredState = async (state: AppState) => {
    // 自救前先强制导出一份原始账本：恢复失败时还有证据可查，原始数据不会先被冲掉。
    await exportRaw();
    saveState(state);
    setStatus('备份已恢复，正在重新载入…');
    window.location.reload();
  };

  const restoreFromText = async (text: string) => {
    setBusy(true);
    setStatus('');
    try {
      await exportRaw();
      const state = validateImport(text, {
        unlockOrphans: true,
        rejectUnsettledInPeriod: true,
      });
      saveState(state);
      setStatus('备份已恢复，正在重新载入…');
      window.location.reload();
    } catch (error) {
      setStatus(
        error instanceof Error ? `恢复失败：${error.message}` : '恢复失败，请检查备份文件。',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setRestoreText(null);
    setRestorePassword('');
    if (file.size > MAX_IMPORT_BYTES) {
      setStatus('备份文件超过 20MB，无法恢复');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      const text = await file.text();
      if (isEncryptedBackup(text)) {
        setRestoreText(text);
        setStatus('这份备份已加密，请输入导出时设置的密码。');
        return;
      }
      await restoreFromText(text);
    } catch (error) {
      setStatus(
        error instanceof Error ? `读取失败：${error.message}` : '读取备份文件失败，请重试',
      );
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const decryptAndRestore = async () => {
    if (!restoreText || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const state = await decryptBackup(restoreText, restorePassword);
      await applyRestoredState(state);
    } catch (error) {
      setStatus(
        error instanceof Error ? `恢复失败：${error.message}` : '恢复失败，请检查密码和备份文件。',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="error-boundary">
      <div className="error-boundary-card" role="alert">
        <div className="error-boundary-brand">
          <Logo size={38} />
          <span>薪时 XINSHI</span>
        </div>
        {unavailable ? (
          <ShieldAlert size={30} color="var(--warning, #B45309)" />
        ) : (
          <AlertTriangle size={30} color="var(--danger)" />
        )}
        <h1>{unavailable ? '本机存储不可用' : '账本需要人工恢复'}</h1>
        {unavailable ? (
          <p>
            浏览器或系统拒绝了本地存储访问（常见于隐私模式、禁用站点数据或企业策略）。
            这不是账本损坏：本机可能还没有任何账本。你仍然可以进入应用，但本次会话的记录
            可能无法保存，请尽快导出备份或退出隐私模式后重新打开。
          </p>
        ) : (
          <p>
            检测到一个已存在的账本无法读取。为防止空数据或旧缓存覆盖它，应用已停止写入。
            请先导出原始内容；如果你手里有备份文件，也可以直接在这里恢复。
          </p>
        )}
        <details className="error-boundary-detail">
          <summary>读取详情</summary>
          <code>{failure.key}：{failure.message}</code>
        </details>
        <div className="error-boundary-actions">
          {failure.raw ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => void exportRawManually()}
              disabled={busy}
            >
              <Download size={16} />
              {busy ? '正在导出…' : '导出原始账本'}
            </button>
          ) : null}
          {!unavailable ? (
            <button
              type="button"
              className="btn btn--soft btn--block"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload size={16} />
              {busy ? '正在恢复…' : '从备份文件恢复'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--soft btn--block"
            onClick={() => window.location.reload()}
            disabled={busy}
          >
            <RefreshCw size={16} />
            重新检测
          </button>
          {unavailable && onContinue ? (
            <button type="button" className="btn btn--ghost btn--block" onClick={onContinue}>
              仍然进入（本次记录可能不保存）
            </button>
          ) : null}
        </div>
        {restoreText ? (
          <div className="error-boundary-actions">
            <input
              className="text-input"
              type="password"
              value={restorePassword}
              onChange={(event) => setRestorePassword(event.target.value)}
              placeholder="输入备份密码"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => void decryptAndRestore()}
              disabled={!restorePassword || busy}
            >
              {busy ? '正在解密…' : '解密并恢复'}
            </button>
          </div>
        ) : null}
        {status ? <p className="error-boundary-status">{status}</p> : null}
        <p className="error-boundary-foot">
          {unavailable
            ? '本机存储被拒绝访问 · 请检查浏览器隐私设置'
            : '原始数据仍保留在本机 · 尚未执行清空或覆盖'}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>
    </div>
  );
}
