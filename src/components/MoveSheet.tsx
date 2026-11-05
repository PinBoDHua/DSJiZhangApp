import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  FileJson,
  KeyRound,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import type { AppState } from '../types';
import { useStore } from '../store';
import { Sheet } from './Sheet';
import { ConfirmDialog } from './ConfirmDialog';
import { validateImport } from '../lib/storage';
import { decryptBackup, isEncryptedBackup } from '../lib/backup';
import { buildMovePackage, isMovePackage, moveFileName, parseMovePackage, shortChecksum, unlockMovePackage, type MovePackageHeader } from '../lib/movePackage';
import {
  diffManifests,
  ledgerManifest,
  saveSnapshot,
  type LedgerManifest,
} from '../lib/snapshots';
import { formatDateTime } from '../lib/date';
import { formatHours, formatMoney } from '../lib/money';
import { isNativeApp, saveTextFile } from '../lib/native';
import { markBackedUp } from '../lib/backupStatus';

interface MoveSheetProps {
  open: boolean;
  mode: 'export' | 'import';
  onClose: () => void;
}

interface ImportPreview {
  state: AppState;
  manifest: LedgerManifest;
  source: string;
  exportedAt?: string;
  checksum?: string;
  encrypted: boolean;
}

type ImportStep = 'pick' | 'password' | 'preview';

export function MoveSheet({ open, mode, onClose }: MoveSheetProps) {
  const { state, replaceState, toast } = useStore();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    checksum: string;
    filename: string;
    path: string;
  } | null>(null);

  const [step, setStep] = useState<ImportStep>('pick');
  const [pendingText, setPendingText] = useState('');
  const [pendingKind, setPendingKind] = useState<'move' | 'encrypted-backup'>('move');
  const [pendingHeader, setPendingHeader] = useState<MovePackageHeader | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirmPassword('');
    setPasswordHint('');
    setError('');
    setBusy(false);
    setResult(null);
    setStep('pick');
    setPendingText('');
    setPendingHeader(null);
    setPreview(null);
    setConfirmOpen(false);
  }, [open, mode]);

  const doExport = async () => {
    setError('');
    if (password && password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      const { text, header } = await buildMovePackage(state, {
        password: password || undefined,
        passwordHint: passwordHint || undefined,
      });
      const filename = moveFileName();
      const saved = await saveTextFile(filename, text);
      markBackedUp();
      setResult({
        checksum: shortChecksum(header.checksum),
        filename,
        path: saved === 'native' ? `下载/Xinshi/${filename}` : filename,
      });
      toast('搬家包已导出', 'success');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : '导出失败');
    } finally {
      setBusy(false);
    }
  };

  const acceptState = (
    next: AppState,
    meta: { source: string; exportedAt?: string; checksum?: string; encrypted: boolean },
  ) => {
    setPreview({
      state: next,
      manifest: ledgerManifest(next),
      source: meta.source,
      exportedAt: meta.exportedAt,
      checksum: meta.checksum,
      encrypted: meta.encrypted,
    });
    setStep('preview');
    setError('');
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const text = await file.text();
      if (isMovePackage(text)) {
        const header = parseMovePackage(text);
        if ('plain' in header.payload) {
          const unlocked = await unlockMovePackage(text);
          acceptState(unlocked.state, {
            source: '搬家包',
            exportedAt: header.exportedAt,
            checksum: shortChecksum(header.checksum),
            encrypted: false,
          });
        } else {
          setPendingText(text);
          setPendingKind('move');
          setPendingHeader(header);
          setStep('password');
        }
      } else if (isEncryptedBackup(text)) {
        setPendingText(text);
        setPendingKind('encrypted-backup');
        setPendingHeader(null);
        setStep('password');
      } else {
        const imported = validateImport(text);
        acceptState(imported, {
          source: '普通备份',
          encrypted: false,
        });
      }
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : '读取文件失败');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const unlockPending = async () => {
    if (!password) {
      setError('请输入密码');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (pendingKind === 'move') {
        const unlocked = await unlockMovePackage(pendingText, password);
        acceptState(unlocked.state, {
          source: '加密搬家包',
          exportedAt: unlocked.header.exportedAt,
          checksum: shortChecksum(unlocked.header.checksum),
          encrypted: true,
        });
      } else {
        const restored = await decryptBackup(pendingText, password);
        acceptState(restored, { source: '加密备份', encrypted: true });
      }
      setPassword('');
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : '解锁失败');
    } finally {
      setBusy(false);
    }
  };

  const importNow = async () => {
    if (!preview) return;
    setConfirmOpen(false);
    try {
      await saveSnapshot(state, 'before-import');
    } catch {
      // 快照失败不阻止导入；确认框已经提示过
    }
    replaceState(preview.state);
    toast('搬家包已导入', 'success');
    onClose();
  };

  const diff = preview ? diffManifests(ledgerManifest(state), preview.manifest) : [];
  const hasCurrentData = state.entries.length > 0 || state.jobs.length > 0;

  if (mode === 'export') {
    return (
      <Sheet
        open={open}
        title="搬家到新手机"
        subtitle="一个文件带走全部账本"
        onClose={onClose}
        className="move-sheet"
      >
        <div className="sheet-body">
          {result ? (
            <div className="move-done">
              <span className="move-done-icon">
                <CheckCircle2 size={26} />
              </span>
              <h3>搬家包已保存</h3>
              <p>
                {isNativeApp() ? `位置：${result.path}` : `文件名：${result.filename}`}
              </p>
              <dl className="move-done-meta">
                <div>
                  <dt>校验码</dt>
                  <dd>{result.checksum}</dd>
                </div>
                <div>
                  <dt>密码</dt>
                  <dd>{password ? '已加密' : '未加密'}</dd>
                </div>
              </dl>
              <p className="move-tip">
                把它用微信文件传输、网盘或数据线发到新手机，在「数据与安全 → 导入」里打开。
                到新手机后核对校验码一致，再覆盖。
              </p>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => {
                  setResult(null);
                  setPassword('');
                  setConfirmPassword('');
                  setPasswordHint('');
                }}
              >
                再存一份
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
                完成
              </button>
            </div>
          ) : (
            <>
              <div className="move-intro">
                <span className="move-intro-icon">
                  <FileJson size={22} />
                </span>
                <div>
                  <strong>带清单、带校验码的完整账本</strong>
                  <p>
                    工作、工记、休息、借支、结算全部带走。导入前会显示两边差异，
                    不会静默覆盖。
                  </p>
                </div>
              </div>

              <label className="field">
                <span className="field-label">设置密码（建议）</span>
                <input
                  className="text-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="至少 6 位；不填则导出明文"
                  autoComplete="new-password"
                  inputMode="text"
                />
              </label>
              <label className="field">
                <span className="field-label">再输一次</span>
                <input
                  className="text-input"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="确认密码"
                  autoComplete="new-password"
                />
              </label>
              <label className="field">
                <span className="field-label">密码提示（可选，会明文写进文件）</span>
                <input
                  className="text-input"
                  value={passwordHint}
                  onChange={(event) => setPasswordHint(event.target.value)}
                  placeholder="例如：生日后四位"
                  maxLength={40}
                />
              </label>

              <p className="move-warning">
                <ShieldAlert size={15} />
                <span>
                  密码不会保存在 App 里。忘记密码，这个搬家包就无法解密；本机账本不受影响。
                  不设密码时，文件里是可读的工资数据。
                </span>
              </p>

              {error ? <p className="move-error">{error}</p> : null}

              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={doExport}
                disabled={busy}
              >
                <LockKeyhole size={17} />
                {busy ? '正在打包…' : '导出搬家包'}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
                取消
              </button>
            </>
          )}
        </div>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet
        open={open}
        title="导入搬家包"
        subtitle="先看差异，再决定"
        onClose={onClose}
        className="move-sheet"
      >
        <div className="sheet-body">
          {step === 'pick' ? (
            <>
              <div className="move-intro">
                <span className="move-intro-icon">
                  <Upload size={22} />
                </span>
                <div>
                  <strong>选择搬家包或旧备份</strong>
                  <p>
                    支持加密搬家包、普通备份、旧版加密备份。文件只在本机读取，
                    不会上传。
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="move-file-picker"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <FileJson size={22} />
                <span>
                  <strong>{busy ? '正在读取…' : '选择 JSON 文件'}</strong>
                  <em>薪时搬家包-*.json / 薪时备份-*.json</em>
                </span>
                <ArrowRight size={18} />
              </button>

              {error ? <p className="move-error">{error}</p> : null}

              <p className="move-tip">
                换手机时建议先在旧手机导出加密搬家包；到新手机后打开这个页面，
                选择文件并输入密码。
              </p>
            </>
          ) : null}

          {step === 'password' ? (
            <>
              <div className="move-intro">
                <span className="move-intro-icon">
                  <KeyRound size={22} />
                </span>
                <div>
                  <strong>这个文件需要密码</strong>
                  <p>
                    {pendingKind === 'move'
                      ? `搬家包导出于 ${
                          pendingHeader ? formatDateTime(pendingHeader.exportedAt) : '未知时间'
                        }`
                      : '旧版加密备份'}
                    {pendingHeader?.passwordHint
                      ? ` · 提示：${pendingHeader.passwordHint}`
                      : ''}
                  </p>
                </div>
              </div>
              <label className="field">
                <span className="field-label">密码</span>
                <input
                  className="text-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="输入导出时设置的密码"
                  autoComplete="current-password"
                  autoFocus
                />
              </label>
              {error ? <p className="move-error">{error}</p> : null}
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={unlockPending}
                disabled={busy}
              >
                {busy ? '正在解密…' : '解密并预览'}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => {
                  setStep('pick');
                  setPassword('');
                  setError('');
                }}
              >
                换一个文件
              </button>
            </>
          ) : null}

          {step === 'preview' && preview ? (
            <>
              <div className="move-preview-head">
                <span className="move-intro-icon">
                  <ShieldCheck size={22} />
                </span>
                <div>
                  <strong>{preview.source} · 校验通过</strong>
                  <p>
                    {preview.exportedAt ? `导出于 ${formatDateTime(preview.exportedAt)}` : ''}
                    {preview.checksum ? ` · 校验码 ${preview.checksum}` : ''}
                  </p>
                </div>
              </div>

              <div className="move-compare">
                <div className="move-compare-head">
                  <span>项目</span>
                  <span>本机</span>
                  <span>包内</span>
                </div>
                {diff.map((row) => (
                  <div className="move-compare-row" key={row.key}>
                    <span>{row.label}</span>
                    <span>{formatDiffValue(row.before, row.unit)}</span>
                    <span className="move-compare-after">
                      {formatDiffValue(row.after, row.unit)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="move-preview-note">
                <p>
                  {hasCurrentData
                    ? '确认后会用包内账本替换当前账本；当前状态会先存一张本机快照，可在「本机时光机」找回。'
                    : '当前账本还是空的，导入后会直接恢复工作与记录。'}
                </p>
                {preview.state.entries.length > 0 ? (
                  <p>
                    包内共 {preview.state.jobs.length} 份工作、
                    {preview.state.entries.length} 笔工记、
                    {preview.state.settlements.length} 张结算单。
                  </p>
                ) : null}
              </div>

              {error ? <p className="move-error">{error}</p> : null}

              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => setConfirmOpen(true)}
              >
                用包覆盖本机
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
                先不导入
              </button>
            </>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </Sheet>

      <ConfirmDialog
        open={confirmOpen}
        title="用搬家包覆盖本机？"
        description={
          preview ? (
            <>
              本机当前数据会先存一张快照。覆盖后：
              {preview.state.jobs.length} 份工作、{preview.state.entries.length} 笔工记、
              {preview.state.settlements.length} 张结算单。
            </>
          ) : null
        }
        confirmLabel="覆盖并导入"
        danger={hasCurrentData}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void importNow()}
      />
    </>
  );
}

function formatDiffValue(value: number, unit: 'count' | 'hours' | 'money'): string {
  if (unit === 'money') return `¥${formatMoney(value)}`;
  if (unit === 'hours') return `${formatHours(value)}h`;
  return String(value);
}
