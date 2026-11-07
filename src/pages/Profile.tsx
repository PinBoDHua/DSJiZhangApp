import { useEffect, useRef, useState } from 'react';
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
  Target,
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
import { TrashSheet } from '../components/TrashSheet';
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
  backupFileName,
  buildExportPayload,
  validateImport,
} from '../lib/storage';
import { decryptBackup, encryptBackup, isEncryptedBackup } from '../lib/backup';
import {
  getLastBackupAt,
  markBackedUp,
} from '../lib/backupStatus';
import { isNativeApp, saveTextFile } from '../lib/native';
import { saveSnapshot } from '../lib/snapshots';
import { APP_VERSION } from '../lib/version';
import {
  getNativeReminderPermission,
  requestNativeReminderPermission,
  sendTestNativeReminder,
  syncDailyReminder,
  type ReminderPermission,
} from '../lib/nativeReminders';

interface ProfileProps {
  onOpenJobs: () => void;
  onOpenDataSafety: () => void;
}

function normalizePermission(
  value: NotificationPermission | 'unsupported',
): ReminderPermission {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  if (value === 'unsupported') return 'unsupported';
  return 'prompt';
}

export function Profile({ onOpenJobs, onOpenDataSafety }: ProfileProps) {
  const { state, updateProfile, updateSettings, replaceState, resetAll, toast } = useStore();
  const nativeApp = isNativeApp();
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState(state.profile.name);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetEnabled, setBudgetEnabled] = useState(false);
  const [budgetIncome, setBudgetIncome] = useState('');
  const [budgetHours, setBudgetHours] = useState('');
  const [budgetError, setBudgetError] = useState('');
  const [trashOpen, setTrashOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<AppState | null>(null);
  const [permission, setPermission] = useState<ReminderPermission>(() => {
    if (nativeApp) return 'prompt';
    return normalizePermission(notificationPermission());
  });
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

  useEffect(() => {
    if (!nativeApp) return;
    let active = true;
    void getNativeReminderPermission().then((next) => {
      if (active) setPermission(next);
    });
    return () => {
      active = false;
    };
  }, [nativeApp]);

  const totals = sumEntriesCapped(state.entries);
  const trashCount =
    state.trashedJobs.length +
    state.trashedEntries.length +
    state.trashedRests.length +
    state.trashedAdvances.length;
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

  const openBudget = () => {
    const budget = state.settings.budget;
    setBudgetEnabled(budget?.enabled ?? false);
    setBudgetIncome(budget?.incomeTarget ? String(budget.incomeTarget) : '');
    setBudgetHours(budget?.hoursLimit ? String(budget.hoursLimit) : '');
    setBudgetError('');
    setBudgetOpen(true);
  };

  const saveBudget = () => {
    const incomeTarget = budgetIncome.trim() ? Number(budgetIncome) : 0;
    const hoursLimit = budgetHours.trim() ? Number(budgetHours) : 0;
    if (!Number.isFinite(incomeTarget) || incomeTarget < 0 || incomeTarget > 100_000_000) {
      setBudgetError('收入目标需在 0–100000000 之间');
      return;
    }
    if (!Number.isFinite(hoursLimit) || hoursLimit < 0 || hoursLimit > 744) {
      setBudgetError('工时上限需在 0–744 小时之间');
      return;
    }
    if (budgetEnabled && incomeTarget <= 0 && hoursLimit <= 0) {
      setBudgetError('至少填写一项收入目标或工时上限，或者先关闭提醒');
      return;
    }
    updateSettings({
      budget: {
        enabled: budgetEnabled,
        incomeTarget: Math.round(incomeTarget * 100) / 100,
        hoursLimit: Math.round(hoursLimit * 100) / 100,
      },
    });
    setBudgetOpen(false);
    toast(budgetEnabled ? '月度预算提醒已开启' : '月度预算提醒已关闭', 'success');
  };

  const handleExport = async () => {
    try {
      const result = await saveTextFile(
        backupFileName(),
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
    if (exportPassword.trim().length < 6) {
      setExportError('密码至少 6 位，且不能全是空格');
      return;
    }
    if (exportPassword.trim() !== exportPasswordConfirm.trim()) {
      setExportError('两次输入的密码不一致');
      return;
    }
    setExportBusy(true);
    setExportError('');
    try {
      const text = await encryptBackup(state, exportPassword);
      const result = await saveTextFile(backupFileName(new Date(), true), text);
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
      const imported = validateImport(text, { unlockOrphans: true });
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

  const confirmImport = async () => {
    if (!pendingImport || importBusy) return;
    setImportBusy(true);
    try {
      await saveSnapshot(state, 'before-import');
      replaceState(pendingImport);
      setPendingImport(null);
      toast('备份已导入，覆盖前账本已留快照');
    } catch (error) {
      toast(
        error instanceof Error
          ? `导入前快照失败，已取消覆盖：${error.message}`
          : '导入前快照失败，已取消覆盖',
        'error',
      );
    } finally {
      setImportBusy(false);
    }
  };

  const clearWithSnapshot = async () => {
    if (importBusy) return;
    setClearOpen(false);
    setImportBusy(true);
    try {
      await saveSnapshot(state, 'before-clear');
      resetAll();
      toast('数据已清空，清空前账本已留快照', 'info');
    } catch (error) {
      toast(
        error instanceof Error
          ? `清空前快照失败，已取消清空：${error.message}`
          : '清空前快照失败，已取消清空',
        'error',
      );
    } finally {
      setImportBusy(false);
    }
  };

  const enableNotifications = async () => {
    const result = nativeApp
      ? await requestNativeReminderPermission()
      : normalizePermission(await askNotificationPermission());
    setPermission(result);
    if (result === 'granted') {
      if (nativeApp) {
        const count = await syncDailyReminder(
          state.settings.reminder,
          !state.entries.some((entry) => entry.date === todayISO()),
        );
        toast(
          count > 0
            ? `系统通知已开启，已排 ${count} 天提醒`
            : '系统通知已开启，明天开始提醒',
        );
      } else {
        toast('浏览器通知已开启');
      }
      return;
    }
    if (result === 'denied') {
      toast(
        nativeApp
          ? '通知被拒绝，请到系统设置 → 应用 → 薪时 → 通知里打开'
          : '通知被拒绝，可在浏览器设置里手动打开',
        'error',
      );
      return;
    }
    if (result === 'unsupported') {
      toast(
        nativeApp ? '当前设备不支持系统通知' : '当前浏览器不支持系统通知',
        'error',
      );
      return;
    }
    toast('没有拿到通知权限，可以再试一次', 'error');
  };

  const testReminder = async () => {
    if (nativeApp) {
      const ok = await sendTestNativeReminder();
      toast(
        ok ? '测试通知已发送，几秒后收到' : '通知发送失败，请检查系统通知权限',
        ok ? 'success' : 'error',
      );
      return;
    }
    const ok = await showLocalNotification(
      '薪时 · 测试提醒',
      '到点我会这样提醒你记工。',
      'xinshi-test',
    );
    toast(ok ? '测试通知已发送' : '通知发送失败，请检查权限', ok ? 'success' : 'error');
  };

  const toggleReminder = async () => {
    const next = !state.settings.reminder.enabled;
    if (next && nativeApp) {
      const result = await requestNativeReminderPermission();
      setPermission(result);
      if (result !== 'granted') {
        toast(
          result === 'denied'
            ? '请在系统设置 → 应用 → 薪时 → 通知里允许通知'
            : '没有拿到系统通知权限，暂时无法开启',
          'error',
        );
        return;
      }
    }
    if (next && !nativeApp) {
      const result = normalizePermission(await askNotificationPermission());
      setPermission(result);
      if (result === 'denied') {
        toast('通知未授权；仍可开启开关后使用「添加到系统日历」', 'info');
      }
    }
    updateSettings({
      reminder: {
        ...state.settings.reminder,
        enabled: next,
      },
    });
  };

  const permissionLabel =
    permission === 'granted'
      ? '已开启'
      : permission === 'denied'
        ? '被拒绝'
        : permission === 'unsupported'
          ? nativeApp
            ? '系统不支持'
            : '浏览器不支持'
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
          <button type="button" className="settings-row" onClick={openBudget}>
            <span className="settings-icon"><Target size={18} /></span>
            <span className="settings-body">
              <strong>月度预算提醒</strong>
              <em>
                {state.settings.budget?.enabled
                  ? `${state.settings.budget.incomeTarget > 0 ? `收入目标 ¥${state.settings.budget.incomeTarget}` : '未设收入目标'}${state.settings.budget.hoursLimit > 0 ? ` · 工时上限 ${state.settings.budget.hoursLimit}h` : ''}`
                  : '设置本月收入目标 / 工时上限，80% 时提醒'}
              </em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
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
              onClick={() => void toggleReminder()}
            >
              <i />
            </button>
          </div>
          {state.settings.reminder.enabled ? (
            <>
              <div className="settings-row settings-row--stack">
                <span className="settings-body">
                  <strong>提醒时间</strong>
                  <em>
                    {nativeApp
                      ? '由系统通知提醒，App 关着也生效；当天已记工会跳过'
                      : '网页通知只在 App 打开时生效'}
                  </em>
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
                  <strong>
                    {nativeApp ? '系统通知' : '浏览器通知'} · {permissionLabel}
                  </strong>
                  <em>
                    {permission === 'granted'
                      ? nativeApp
                        ? '已就绪，App 关着也会按时间提醒'
                        : '系统通知已就绪'
                      : permission === 'denied'
                        ? nativeApp
                          ? '需到系统设置 → 应用 → 薪时 → 通知里手动允许'
                          : '需到浏览器站点设置里手动允许'
                        : permission === 'unsupported'
                          ? nativeApp
                            ? '当前设备不支持系统通知'
                            : '当前浏览器不支持系统通知'
                          : nativeApp
                            ? '首次开启会请求系统通知权限'
                            : '首次开启会请求通知权限'}
                  </em>
                </span>
                <div className="reminder-actions">
                  <button
                    type="button"
                    className="btn btn--soft btn--sm"
                    onClick={() => void enableNotifications()}
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
                    onClick={() => void testReminder()}
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
          {nativeApp
            ? '系统通知由本地闹钟调度，不依赖服务器；省电模式下可能延迟。'
            : '网页通知受浏览器限制，只会在 App 打开时提醒；想关掉 App 也提醒，请用「添加到系统日历」。'}
        </p>
      </section>

      <section className="settings-group">
        <h2>数据</h2>
        <div className="settings-card">
          <button type="button" className="settings-row" onClick={onOpenDataSafety}>
            <span className="settings-icon">
              <ShieldCheck size={18} />
            </span>
            <span className="settings-body">
              <strong>数据与安全</strong>
              <em>备份、搬家、本机时光机、账本体检、Excel 导出</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
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
          <button type="button" className="settings-row" onClick={() => setTrashOpen(true)}>
            <span className="settings-icon">
              <Trash2 size={18} />
            </span>
            <span className="settings-body">
              <strong>
                回收站
                {trashCount > 0 ? <span className="micro-badge">{trashCount}</span> : null}
              </strong>
              <em>
                {trashCount > 0
                  ? `${trashCount} 条已删除记录，30 天内可恢复`
                  : '删除的工记、休息、借支和工作会先放这里'}
              </em>
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
              <em>v{APP_VERSION} · 每一小时，都算数</em>
            </span>
            <ChevronRight size={16} className="settings-chevron" />
          </button>
        </div>
      </section>

      <p className="profile-footer">
        薪时 XINSHI · v{APP_VERSION}
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

      <Sheet open={budgetOpen} title="月度预算提醒" subtitle="用于记工目标管理，不是消费支出预算" onClose={() => setBudgetOpen(false)}>
        <div className="sheet-body">
          <div className="settings-card budget-enable-row">
            <div className="settings-row">
              <span className="settings-body"><strong>启用本月提醒</strong><em>达到 80% 提醒，达到目标 / 上限再次提示</em></span>
              <button type="button" className={`switch ${budgetEnabled ? 'is-on' : ''}`} role="switch" aria-checked={budgetEnabled} aria-label="启用月度预算提醒" onClick={() => setBudgetEnabled((value) => !value)}><i /></button>
            </div>
          </div>
          <label className="field">
            <span className="field-label">本月收入目标（元，选填）</span>
            <input className="text-input" type="number" min={0} max={100000000} step={100} value={budgetIncome} onChange={(event) => { setBudgetIncome(event.target.value); setBudgetError(''); }} placeholder="例如 6000" inputMode="decimal" />
          </label>
          <label className="field">
            <span className="field-label">本月工时上限（小时，选填）</span>
            <input className="text-input" type="number" min={0} max={744} step={1} value={budgetHours} onChange={(event) => { setBudgetHours(event.target.value); setBudgetError(''); }} placeholder="例如 200" inputMode="decimal" />
          </label>
          <p className="field-hint">只统计当前月且日期不超过今天的工记；未来计划不计入。提醒显示在首页、统计和本月首次跨档 Toast，不需要通知权限。</p>
          {budgetError ? <p className="form-error">{budgetError}</p> : null}
        </div>
        <div className="sheet-footer">
          <button type="button" className="btn btn--ghost" onClick={() => setBudgetOpen(false)}>取消</button>
          <button type="button" className="btn btn--primary" onClick={saveBudget}>保存预算</button>
        </div>
      </Sheet>

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
            <span className="about-version">v{APP_VERSION}</span>
          </div>
          <p className="about-copy">
            给小时工、日结工、周结工和月结工用的个人记工工具。记工时、算工钱、等发薪，
            一本清楚的账。
          </p>
          <ul className="about-list">
            <li>时薪 / 日薪 / 月薪 / 计件，四种算法</li>
            <li>固定月薪、随机休息、月度考勤与半天休</li>
            <li>默认班次模板，支持 6h + 午休 2h</li>
            <li>日结 / 周结 / 月结，逐期结算留底</li>
            <li>计时、日历、提醒、深色模式、离线使用</li>
            <li>工资条图片 / 文字版 PDF、结算二维码、考勤 CSV</li>
            <li>AES-GCM 加密备份</li>
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

      <TrashSheet open={trashOpen} onClose={() => setTrashOpen(false)} />

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="导入这份备份？"
        description={
          pendingImport ? (
            <>
              将覆盖当前数据：{pendingImport.jobs.length} 份工作、
              {pendingImport.entries.length} 笔工记、{pendingImport.settlements.length} 张结算单。
              当前数据会先保存到本机时光机；快照失败时会取消导入。
            </>
          ) : null
        }
        confirmLabel="覆盖并导入"
        onCancel={() => setPendingImport(null)}
        onConfirm={() => void confirmImport()}
      />

      <ConfirmDialog
        open={clearOpen}
        title="清空所有数据？"
        description="工作、工记、借支和结算单会全部删除。清空前必须成功保存本机快照，否则不会执行。"
        confirmLabel="全部清空"
        danger
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void clearWithSnapshot()}
      />
    </div>
  );
}
