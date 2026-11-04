import { useRef, useState } from 'react';
import {
  Bell,
  Briefcase,
  CalendarPlus,
  ChevronRight,
  Download,
  Info,
  LockKeyhole,
  Pencil,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import type { AppState, ThemeMode } from '../types';
import { useStore } from '../store';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Logo } from '../components/Logo';
import { Money } from '../components/Money';
import { Segmented } from '../components/Segmented';
import { Sheet } from '../components/Sheet';
import { formatMonthTitle, todayISO } from '../lib/date';
import { formatHours } from '../lib/money';
import { sumEntriesCapped } from '../lib/settlement';
import {
  askNotificationPermission,
  downloadReminderIcs,
  notificationPermission,
  showLocalNotification,
} from '../lib/reminder';
import {
  buildExportPayload,
  validateImport,
} from '../lib/storage';
import { decryptBackup, encryptBackup, isEncryptedBackup } from '../lib/backup';
import {
  getLastBackupAt,
  markBackedUp,
} from '../lib/backupStatus';
import { isNativeApp, saveTextFile } from '../lib/native';

interface ProfileProps {
  onOpenJobs: () => void;
}

export function Profile({ onOpenJobs }: ProfileProps) {
  const { state, updateProfile, updateSettings, replaceState, resetAll, toast } = useStore();
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(state.profile.name);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<AppState | null>(null);
  const [permission, setPermission] = useState(() => notificationPermission());
  const [backupAt, setBackupAt] = useState(() => getLastBackupAt());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const [encryptedImportText, setEncryptedImportText] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const totals = sumEntriesCapped(state.entries);
  const activeJobs = state.jobs.filter((job) => !job.archived);
  const name = state.profile.name.trim() || '工友';
  const initial = name.slice(0, 1);
  const startDate = new Date(state.createdAt);
  const usedDays = Number.isNaN(startDate.getTime())
    ? 1
    : Math.max(1, Math.floor((Date.now() - startDate.getTime()) / 86400000) + 1);

  const saveName = () => {
    updateProfile({ name: nameDraft.trim() });
    setNameOpen(false);
    toast('称呼已更新');
  };

  const handleExport = async () => {
    try {
      const result = await saveTextFile(
        `薪时备份-${todayISO()}.json`,
        buildExportPayload(state),
      );
      markBackedUp();
      setBackupAt(getLastBackupAt());
      toast(
        result === 'native'
          ? '备份已保存到「下载/Xinshi」'
          : '备份已导出，请保存好文件',
      );
    } catch {
      toast('导出失败，请稍后再试', 'error');
    }
  };

  const exportEncrypted = async () => {
    if (exportPassword.length < 6) {
      setExportError('密码至少 6 位');
      return;
    }
    if (exportPassword !== exportPasswordConfirm) {
      setExportError('两次输入的密码不一致');
      return;
    }
    setExportBusy(true);
    setExportError('');
    try {
      const text = await encryptBackup(state, exportPassword);
      const result = await saveTextFile(`薪时加密备份-${todayISO()}.json`, text);
      markBackedUp();
      setBackupAt(getLastBackupAt());
      setExportOpen(false);
      setExportPassword('');
      setExportPasswordConfirm('');
      toast(
        result === 'native'
          ? '加密备份已保存到「下载/Xinshi」'
          : '加密备份已导出，请记住密码',
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '加密导出失败');
    } finally {
      setExportBusy(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      if (isEncryptedBackup(text)) {
        setEncryptedImportText(text);
        setImportPassword('');
        setImportError('');
        return;
      }
      const imported = validateImport(text);
      setPendingImport(imported);
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败，请检查文件';
      toast(message, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const decryptAndStage = async () => {
    if (!encryptedImportText) return;
    setImportBusy(true);
    setImportError('');
    try {
      const imported = await decryptBackup(encryptedImportText, importPassword);
      setEncryptedImportText(null);
      setPendingImport(imported);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '解密失败');
    } finally {
      setImportBusy(false);
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    replaceState(pendingImport);
    setPendingImport(null);
    toast('备份已导入');
  };

  const enableNotifications = async () => {
    const result = await askNotificationPermission();
    setPermission(result);
    if (result === 'granted') toast('浏览器通知已开启');
    else if (result === 'denied') toast('通知被拒绝，可在浏览器设置里手动打开', 'error');
    else if (result === 'unsupported') toast('当前浏览器不支持系统通知', 'error');
  };

  const testReminder = async () => {
    const ok = await showLocalNotification(
      '薪时 · 测试提醒',
      '到点我会这样提醒你记工。',
      'xinshi-test',
    );
    toast(ok ? '测试通知已发送' : '通知发送失败，请检查权限', ok ? 'success' : 'error');
  };

  const permissionLabel =
    permission === 'granted'
      ? '已开启'
      : permission === 'denied'
        ? '被拒绝'
        : permission === 'unsupported'
          ? '浏览器不支持'
          : '未开启';

  return (
    <div className="page profile-page">
      <header className="page-heading">
        <p className="eyebrow">我的账本</p>
        <h1>我的</h1>
      </header>

      <section className="profile-card">
        <span className="profile-avatar">{initial}</span>
        <div className="profile-main">
          <h2>{name}</h2>
          <p>
            使用第 {usedDays} 天 · 累计出勤 {totals.days} 天
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            setNameDraft(state.profile.name);
            setNameOpen(true);
          }}
          aria-label="编辑称呼"
        >
          <Pencil size={16} />
        </button>
      </section>

      <div className="profile-stats">
        <div>
          <span>累计收入</span>
          <Money value={totals.total} />
        </div>
        <div>
          <span>累计工时</span>
          <strong>{formatHours(totals.hours)}h</strong>
        </div>
        <div>
          <span>进行中工作</span>
          <strong>{activeJobs.length}</strong>
        </div>
      </div>

      <section className="settings-group">
        <h2>工作</h2>
        <div className="settings-card">
          <button type="button" className="settings-row" onClick={onOpenJobs}>
            <span className="settings-icon">
              <Briefcase size={18} />
            </span>
            <span className="settings-body">
              <strong>工作管理</strong>
              <em>单价、结算周期、加班规则</em>
            </span>
            <span className="settings-tail">
              {state.jobs.length} 份
              <ChevronRight size={16} />
            </span>
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2>外观</h2>
        <div className="settings-card">
          <div className="settings-row settings-row--stack">
            <span className="settings-body">
              <strong>主题</strong>
              <em>跟随系统，或固定浅色 / 深色</em>
            </span>
            <Segmented
              value={state.settings.theme}
              onChange={(value) => updateSettings({ theme: value as ThemeMode })}
              options={[
                { value: 'system', label: '跟随系统' },
                { value: 'light', label: '浅色' },
                { value: 'dark', label: '深色' },
              ]}
              size="sm"
              ariaLabel="主题模式"
            />
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h2>偏好</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-icon">
              <ShieldCheck size={18} />
            </span>
            <span className="settings-body">
              <strong>隐藏金额</strong>
              <em>首页、记录、结算和详情不显示具体数字</em>
            </span>
            <button
              type="button"
              className={`switch ${state.profile.hideAmounts ? 'is-on' : ''}`}
              role="switch"
              aria-checked={state.profile.hideAmounts}
              aria-label="隐藏金额"
              onClick={() => updateProfile({ hideAmounts: !state.profile.hideAmounts })}
            >
              <i />
            </button>
          </div>
          <div className="settings-row settings-row--stack">
            <span className="settings-body">
              <strong>一周从哪天开始</strong>
              <em>影响周结的统计区间，默认周一</em>
            </span>
            <Segmented
              value={String(state.settings.weekStartsOn)}
              onChange={(value) =>
                updateSettings({ weekStartsOn: value === '0' ? 0 : 1 })
              }
              options={[
                { value: '1', label: '周一' },
                { value: '0', label: '周日' },
              ]}
              size="sm"
              ariaLabel="一周起始日"
            />
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h2>提醒</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-icon">
              <Bell size={18} />
            </span>
            <span className="settings-body">
              <strong>每日记工提醒</strong>
              <em>
                {state.settings.reminder.enabled
                  ? `每天 ${state.settings.reminder.time} 提醒还没记工的日子`
                  : '到点提醒你，别忘了当天的工钱'}
              </em>
            </span>
            <button
              type="button"
              className={`switch ${state.settings.reminder.enabled ? 'is-on' : ''}`}
              role="switch"
              aria-checked={state.settings.reminder.enabled}
              aria-label="每日记工提醒"
              onClick={() =>
                updateSettings({
                  reminder: {
                    ...state.settings.reminder,
                    enabled: !state.settings.reminder.enabled,
                  },
                })
              }
            >
              <i />
            </button>
          </div>
          {state.settings.reminder.enabled ? (
            <>
              <div className="settings-row settings-row--stack">
                <span className="settings-body">
                  <strong>提醒时间</strong>
                  <em>网页通知只在 App 打开时生效</em>
                </span>
                <input
                  className="time-input"
                  type="time"
                  value={state.settings.reminder.time}
                  onChange={(event) => {
                    if (event.target.value) {
                      updateSettings({
                        reminder: {
                          ...state.settings.reminder,
                          time: event.target.value,
                        },
                      });
                    }
                  }}
                  aria-label="提醒时间"
                />
              </div>
              <div className="settings-row settings-row--stack">
                <span className="settings-body">
                  <strong>浏览器通知 · {permissionLabel}</strong>
                  <em>
                    {permission === 'granted'
                      ? '系统通知已就绪'
                      : permission === 'denied'
                        ? '需到浏览器站点设置里手动允许'
                        : permission === 'unsupported'
                          ? '当前浏览器不支持系统通知'
                          : '首次开启会请求通知权限'}
                  </em>
                </span>
                <div className="reminder-actions">
                  <button
                    type="button"
                    className="btn btn--soft btn--sm"
                    onClick={enableNotifications}
                    disabled={permission === 'unsupported' || permission === 'granted'}
                  >
                    {permission === 'granted'
                      ? '通知已开启'
                      : permission === 'denied'
                        ? '重新申请'
                        : '开启通知'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={testReminder}
                    disabled={permission !== 'granted'}
                  >
                    测试通知
                  </button>
                </div>
              </div>
              <button
                type="button"
                className="settings-row"
                onClick={() => {
                  downloadReminderIcs(state.settings.reminder.time);
                  toast('日历提醒已生成，导入系统日历即可每天提醒');
                }}
              >
                <span className="settings-icon">
                  <CalendarPlus size={18} />
                </span>
                <span className="settings-body">
                  <strong>添加到系统日历</strong>
                  <em>生成 .ics 文件，App 关着也能按时提醒</em>
                </span>
                <ChevronRight size={16} className="settings-chevron" />
              </button>
            </>
          ) : null}
        </div>
        <p className="settings-note">
          <Bell size={14} />
          网页通知受浏览器限制，只会在 App 打开时提醒；想关掉 App 也提醒，请用「添加到系统日历」。
        </p>
      </section>

      <section className="settings-group">
        <h2>数据</h2>
        <div className="settings-card">
          <button type="button" className="settings-row" onClick={handleExport}>
            <span className="settings-icon">
              <Download size={18} />
            </span>
            <span className="settings-body">
              <strong>导出备份</strong>
              <em>普通 JSON 文件，方便随时恢复</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
          <button type="button" className="settings-row" onClick={() => {
            setExportError('');
            setExportPassword('');
            setExportPasswordConfirm('');
            setExportOpen(true);
          }}>
            <span className="settings-icon">
              <LockKeyhole size={18} />
            </span>
            <span className="settings-body">
              <strong>导出加密备份</strong>
              <em>
                {isNativeApp()
                  ? '设置密码，生成后保存到系统下载目录'
                  : '设置密码，文件内容全程加密'}
              </em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
          <button type="button" className="settings-row" onClick={() => fileRef.current?.click()}>
            <span className="settings-icon">
              <Upload size={18} />
            </span>
            <span className="settings-body">
              <strong>导入备份</strong>
              <em>支持普通或加密 JSON 文件</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
          <button
            type="button"
            className="settings-row settings-row--danger"
            onClick={() => setClearOpen(true)}
          >
            <span className="settings-icon">
              <Trash2 size={18} />
            </span>
            <span className="settings-body">
              <strong>清空所有数据</strong>
              <em>会删除工作和全部记录，请先导出备份</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
        </div>
        <p className="settings-note">
          <ShieldCheck size={14} />
          <span>
            {backupAt
              ? `上次备份：${new Date(backupAt).toLocaleDateString('zh-CN')}`
              : '还没有导出过备份'}
            {state.entries.length > 0 && !backupAt ? '，建议现在就存一份' : ''}
          </span>
        </p>
        <p className="settings-note">
          <ShieldCheck size={14} />
          数据只保存在这台设备的浏览器里，不上传服务器。
        </p>
      </section>

      <section className="settings-group">
        <h2>关于</h2>
        <div className="settings-card">
          <button type="button" className="settings-row" onClick={() => setAboutOpen(true)}>
            <span className="settings-icon">
              <Info size={18} />
            </span>
            <span className="settings-body">
              <strong>关于薪时</strong>
              <em>v0.4.3 · 每一小时，都算数</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
        </div>
      </section>

      <p className="profile-footer">
        薪时 XINSHI · v0.4.3
        <br />
        个人记工工具，计算结果仅供参考
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      <Sheet open={nameOpen} title="修改称呼" onClose={() => setNameOpen(false)}>
        <div className="sheet-body">
          <label className="field">
            <span className="field-label">怎么称呼你</span>
            <input
              className="text-input"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="工友"
              maxLength={12}
              autoFocus
            />
          </label>
          <p className="field-hint">只显示在本机，不影响账目。</p>
        </div>
        <div className="sheet-footer">
          <button type="button" className="btn btn--ghost" onClick={() => setNameOpen(false)}>
            取消
          </button>
          <button type="button" className="btn btn--primary" onClick={saveName}>
            保存
          </button>
        </div>
      </Sheet>

      <Sheet open={aboutOpen} title="关于薪时" onClose={() => setAboutOpen(false)}>
        <div className="sheet-body about-body">
          <div className="about-brand">
            <Logo size={48} />
            <div>
              <h3>薪时 XINSHI</h3>
              <p>每一小时，都算数。</p>
            </div>
            <span className="about-version">v0.4.3</span>
          </div>
          <p className="about-copy">
            给小时工、日结工、周结工和月结工用的个人记工工具。记工时、算工钱、等发薪，
            一本清楚的账。
          </p>
          <ul className="about-list">
            <li>时薪 / 日薪 / 月薪 / 计件，四种算法</li>
            <li>固定月薪、月休额度、随机休息留痕</li>
            <li>默认班次模板，支持 6h + 午休 2h</li>
            <li>日结 / 周结 / 月结，逐期结算留底</li>
            <li>计时、日历、提醒、深色模式、离线使用</li>
            <li>工资条图片 / PDF、AES-GCM 加密备份</li>
          </ul>
          <div className="about-disclaimer">
            <strong>说明</strong>
            <p>
              计算结果仅供参考，不构成劳动、税务或法律意见。实际工资以用人单位约定与结算为准。
              换设备或清理浏览器数据前，请先在「数据」里导出备份。
            </p>
          </div>
          <p className="about-sign">薪时 · {formatMonthTitle(todayISO())}</p>
        </div>
        <div className="sheet-footer">
          <button type="button" className="btn btn--primary btn--block" onClick={() => setAboutOpen(false)}>
            知道了
          </button>
        </div>
      </Sheet>

      <Sheet
        open={exportOpen}
        title="设置备份密码"
        subtitle="密码不会保存，忘记后无法恢复文件"
        onClose={() => {
          setExportOpen(false);
          setExportError('');
        }}
      >
        <div className="sheet-body">
          <label className="field">
            <span className="field-label">备份密码</span>
            <input
              className="text-input"
              type="password"
              value={exportPassword}
              onChange={(event) => {
                setExportPassword(event.target.value);
                if (exportError) setExportError('');
              }}
              placeholder="至少 6 位，建议用一句话"
              autoComplete="new-password"
              autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">再输一次</span>
            <input
              className="text-input"
              type="password"
              value={exportPasswordConfirm}
              onChange={(event) => {
                setExportPasswordConfirm(event.target.value);
                if (exportError) setExportError('');
              }}
              placeholder="确认密码"
              autoComplete="new-password"
            />
          </label>
          {exportError ? <p className="form-error">{exportError}</p> : null}
          <p className="inline-hint">
            <ShieldCheck size={14} />
            文件使用 AES-GCM 加密，只有密码能打开。密码不会上传，也没有找回入口。
          </p>
        </div>
        <div className="sheet-footer">
          <button
            type="button"
            className="btn btn--soft"
            onClick={() => setExportOpen(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={exportEncrypted}
            disabled={exportBusy}
          >
            {exportBusy ? '加密中…' : '导出加密备份'}
          </button>
        </div>
      </Sheet>

      <Sheet
        open={Boolean(encryptedImportText)}
        title="输入备份密码"
        subtitle="解密成功后再确认是否覆盖当前数据"
        onClose={() => {
          setEncryptedImportText(null);
          setImportError('');
        }}
      >
        <div className="sheet-body">
          <label className="field">
            <span className="field-label">备份密码</span>
            <input
              className="text-input"
              type="password"
              value={importPassword}
              onChange={(event) => {
                setImportPassword(event.target.value);
                if (importError) setImportError('');
              }}
              placeholder="导出时设置的密码"
              autoComplete="current-password"
              autoFocus
            />
          </label>
          {importError ? <p className="form-error">{importError}</p> : null}
          <p className="inline-hint">
            <LockKeyhole size={14} />
            密码错误或文件被改动过，都无法解密。
          </p>
        </div>
        <div className="sheet-footer">
          <button
            type="button"
            className="btn btn--soft"
            onClick={() => setEncryptedImportText(null)}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={decryptAndStage}
            disabled={!importPassword || importBusy}
          >
            {importBusy ? '解密中…' : '解密并导入'}
          </button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="导入这份备份？"
        description={
          pendingImport ? (
            <>
              将覆盖当前数据：{pendingImport.jobs.length} 份工作、
              {pendingImport.entries.length} 笔工记、{pendingImport.settlements.length} 张结算单。
              当前数据无法恢复，建议先导出备份。
            </>
          ) : null
        }
        confirmLabel="覆盖并导入"
        onCancel={() => setPendingImport(null)}
        onConfirm={confirmImport}
      />

      <ConfirmDialog
        open={clearOpen}
        title="清空所有数据？"
        description="工作、工记、借支和结算单会全部删除，无法恢复。建议先导出备份。"
        confirmLabel="全部清空"
        danger
        onCancel={() => setClearOpen(false)}
        onConfirm={() => {
          setClearOpen(false);
          resetAll();
          toast('数据已清空', 'info');
        }}
      />
    </div>
  );
}
