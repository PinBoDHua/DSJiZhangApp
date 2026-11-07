import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { BottomNav, type TabKey } from './components/BottomNav';
import { Fab } from './components/Fab';
import { EntryDetail } from './components/EntryDetail';
import { PageLoading } from './components/PageLoading';
import { Home } from './pages/Home';
import { EntryEditor } from './pages/EntryEditor';
import { Onboarding } from './pages/Onboarding';
import { PrivacyGate } from './components/PrivacyGate';
import { grantPrivacyConsent, hasPrivacyConsent } from './lib/compliance';
import { runAutoBackup } from './lib/autoBackup';
import type { TimerTimes } from './lib/timer';
import { useTheme } from './hooks/useTheme';
import { useReminder } from './hooks/useReminder';
import { useAutoSnapshot } from './hooks/useAutoSnapshot';
import { useVisualViewport } from './hooks/useVisualViewport';
import { todayISO } from './lib/date';
import { pushNativeBack } from './lib/nativeBack';
import { schedulePaydayNotifications } from './lib/paydayNotifications';
import { cancelDailyReminder, syncDailyReminder } from './lib/nativeReminders';
import { isNativeApp } from './lib/native';
import { monthlyBudgetStatus, shouldToastBudgetAlert } from './lib/budget';

const loadRecords = () => import('./pages/Records');
const loadSettlements = () => import('./pages/Settlements');
const loadStats = () => import('./pages/Stats');
const loadProfile = () => import('./pages/Profile');
const loadJobs = () => import('./pages/Jobs');
const loadSearch = () => import('./pages/Search');

const Records = lazy(() => loadRecords().then((module) => ({ default: module.Records })));
const Settlements = lazy(() =>
  loadSettlements().then((module) => ({ default: module.Settlements })),
);
const Stats = lazy(() => loadStats().then((module) => ({ default: module.Stats })));
const Profile = lazy(() =>
  loadProfile().then((module) => ({ default: module.Profile })),
);
const Jobs = lazy(() => loadJobs().then((module) => ({ default: module.Jobs })));
const JobEditor = lazy(() =>
  import('./pages/JobEditor').then((module) => ({ default: module.JobEditor })),
);
const SettlementDraftPage = lazy(() =>
  import('./pages/SettlementPage').then((module) => ({ default: module.SettlementDraftPage })),
);
const SettlementRecordPage = lazy(() =>
  import('./pages/SettlementPage').then((module) => ({ default: module.SettlementRecordPage })),
);
const AttendancePage = lazy(() =>
  import('./pages/Attendance').then((module) => ({ default: module.AttendancePage })),
);
const DataSafety = lazy(() =>
  import('./pages/DataSafety').then((module) => ({ default: module.DataSafety })),
);
const Snapshots = lazy(() =>
  import('./pages/Snapshots').then((module) => ({ default: module.Snapshots })),
);
const Health = lazy(() => import('./pages/Health').then((module) => ({ default: module.Health })));
const Privacy = lazy(() =>
  import('./pages/Privacy').then((module) => ({ default: module.Privacy })),
);
const Search = lazy(() => loadSearch().then((module) => ({ default: module.Search })));
const Recurring = lazy(() =>
  import('./pages/Recurring').then((module) => ({ default: module.Recurring })),
);

/** 底部 Tab 与高频子页：首屏画完后空闲预取，切换时不再先出骨架。 */
const PREFETCH_LOADERS = [
  loadRecords,
  loadSettlements,
  loadStats,
  loadProfile,
  loadJobs,
  loadSearch,
];

interface NetworkInformation {
  saveData?: boolean;
}

function prefetchRouteChunks(): () => void {
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData) return () => undefined;
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    for (const load of PREFETCH_LOADERS) {
      void load().catch(() => undefined);
    }
  };
  if (window.requestIdleCallback) {
    const handle = window.requestIdleCallback(run, { timeout: 2500 });
    return () => {
      cancelled = true;
      window.cancelIdleCallback?.(handle);
    };
  }
  const timer = window.setTimeout(run, 1600);
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
  };
}

type Page =
  | { type: 'jobs' }
  | { type: 'search' }
  | { type: 'recurring' }
  | { type: 'jobEditor'; jobId?: string; template?: 'longterm' }
  | { type: 'settlementDraft'; jobId: string; periodStart: string }
  | { type: 'settlementRecord'; settlementId: string }
  | { type: 'attendance'; jobId?: string }
  | { type: 'dataSafety' }
  | { type: 'snapshots' }
  | { type: 'health' }
  | { type: 'privacy' };

interface EditorState {
  entryId?: string;
  jobId?: string;
  initialTimes?: TimerTimes;
  date?: string;
}

export default function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}

function AppContent() {
  const { state, generateRecurring, toast } = useStore();
  const [tab, setTab] = useState<TabKey>('home');
  const [page, setPage] = useState<Page | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [privacyOk, setPrivacyOk] = useState(() => hasPrivacyConsent());
  const autoRecurringRan = useRef(false);
  const today = todayISO();
  const currentMonth = today.slice(0, 7);
  const budgetStatus = monthlyBudgetStatus(
    state.settings.budget,
    state.entries.filter((entry) => entry.date.startsWith(currentMonth)),
    today,
  );
  useTheme(state.settings.theme);
  useVisualViewport();
  const todayEntryCount = state.entries.filter((entry) => entry.date === todayISO()).length;
  useReminder(state.settings.reminder, todayEntryCount);
  useAutoSnapshot(state, privacyOk);

  useEffect(() => {
    if (!privacyOk || !state.onboardingDone || autoRecurringRan.current) return;
    autoRecurringRan.current = true;
    const result = generateRecurring({ automaticOnly: true, today });
    if (result.added > 0) {
      toast(`周期规则已补记 ${result.added} 笔${result.skipped > 0 ? `，跳过 ${result.skipped} 天` : ''}`);
    }
  }, [privacyOk, state.onboardingDone, generateRecurring, today, toast]);

  useEffect(() => {
    if (!privacyOk || !state.onboardingDone || !budgetStatus?.alert) return;
    if (!shouldToastBudgetAlert(currentMonth, budgetStatus)) return;
    toast(
      budgetStatus.alert.message,
      budgetStatus.alert.tone === 'warning' ? 'error' : budgetStatus.alert.tone,
    );
  }, [
    privacyOk,
    state.onboardingDone,
    currentMonth,
    budgetStatus?.alert?.code,
    budgetStatus?.incomeTarget,
    budgetStatus?.hoursLimit,
    toast,
  ]);

  useEffect(() => {
    void schedulePaydayNotifications(state.jobs);
  }, [state.jobs]);

  useEffect(() => {
    if (!isNativeApp()) return;
    if (!state.settings.reminder.enabled) {
      void cancelDailyReminder();
      return;
    }
    void syncDailyReminder(state.settings.reminder, todayEntryCount === 0);
  }, [
    state.settings.reminder.enabled,
    state.settings.reminder.time,
    todayEntryCount,
  ]);

  useEffect(() => {
    if (!privacyOk || !state.onboardingDone) return;
    void runAutoBackup(state);
  }, [privacyOk, state]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [tab, state.onboardingDone]);

  useEffect(() => {
    if (!page || page.type === 'jobEditor' || page.type === 'settlementDraft') return;
    return pushNativeBack(() => setPage(null));
  }, [page]);

  useEffect(() => {
    if (state.onboardingDone) return;
    setPage(null);
    setTab('home');
  }, [state.onboardingDone]);

  useEffect(() => {
    if (!state.onboardingDone) return;
    return prefetchRouteChunks();
  }, [state.onboardingDone]);

  if (!privacyOk) {
    return (
      <PrivacyGate
        onAgree={() => {
          grantPrivacyConsent();
          setPrivacyOk(true);
        }}
      />
    );
  }

  const openEntryEditor = (jobId?: string, date?: string) => {
    setEditor({ jobId, date });
  };

  const openEntryDetail = (entryId: string) => {
    setDetailId(entryId);
  };

  const openJobs = () => setPage({ type: 'jobs' });

  const onManageJobsFromEditor = () => {
    setEditor(null);
    setPage({ type: 'jobs' });
  };

  const renderTab = () => {
    if (tab === 'home') {
      return (
        <Home
          onAddEntry={openEntryEditor}
          onAddEntryAt={(jobId, date) => openEntryEditor(jobId, date)}
          onOpenEntry={openEntryDetail}
          onOpenJobs={openJobs}
          onGoRecords={() => setTab('records')}
          onGoSettlements={() => setTab('settlements')}
          onOpenProfile={() => setTab('profile')}
          onOpenDataSafety={() => setPage({ type: 'dataSafety' })}
          onFinishTimer={(jobId, times) => setEditor({ jobId, initialTimes: times })}
        />
      );
    }
    if (tab === 'records') {
      return (
        <Records
          onAddEntry={() => openEntryEditor()}
          onAddEntryAt={(jobId, date) => openEntryEditor(jobId, date)}
          onOpenEntry={openEntryDetail}
          onOpenJobs={openJobs}
          onOpenSearch={() => setPage({ type: 'search' })}
          onOpenAttendance={(jobId) => setPage({ type: 'attendance', jobId })}
          onOpenRecurring={() => setPage({ type: 'recurring' })}
        />
      );
    }
    if (tab === 'settlements') {
      return (
        <Settlements
          onOpenDraft={(jobId, periodStart) =>
            setPage({ type: 'settlementDraft', jobId, periodStart })
          }
          onOpenRecord={(settlementId) =>
            setPage({ type: 'settlementRecord', settlementId })
          }
          onAddEntry={() => openEntryEditor()}
          onOpenJobs={openJobs}
        />
      );
    }
    if (tab === 'stats') {
      return <Stats onAddEntry={() => openEntryEditor()} />;
    }
    return <Profile onOpenJobs={openJobs} onOpenDataSafety={() => setPage({ type: 'dataSafety' })} />;
  };

  const renderPage = () => {
    if (!page) return null;
    if (page.type === 'jobs') {
      return (
        <Jobs
          onBack={() => setPage(null)}
          onAdd={() => setPage({ type: 'jobEditor' })}
          onTemplate={() => setPage({ type: 'jobEditor', template: 'longterm' })}
          onEdit={(jobId) => setPage({ type: 'jobEditor', jobId })}
        />
      );
    }
    if (page.type === 'search') {
      return <Search onBack={() => setPage(null)} onOpenEntry={openEntryDetail} />;
    }
    if (page.type === 'recurring') {
      return <Recurring onBack={() => setPage(null)} />;
    }
    if (page.type === 'jobEditor') {
      return (
        <JobEditor
          key={page.jobId ?? page.template ?? 'new'}
          jobId={page.jobId}
          template={page.template}
          onBack={() => setPage({ type: 'jobs' })}
        />
      );
    }
    if (page.type === 'attendance') {
      return (
        <AttendancePage
          initialJobId={page.jobId}
          onBack={() => setPage(null)}
          onAddEntry={(jobId, date) => openEntryEditor(jobId, date)}
          onOpenEntry={openEntryDetail}
        />
      );
    }
    if (page.type === 'dataSafety') {
      return (
        <DataSafety
          onBack={() => setPage(null)}
          onOpenSnapshots={() => setPage({ type: 'snapshots' })}
          onOpenHealth={() => setPage({ type: 'health' })}
          onOpenPrivacy={() => setPage({ type: 'privacy' })}
        />
      );
    }
    if (page.type === 'snapshots') {
      return (
        <Snapshots
          onBack={() => setPage(state.onboardingDone ? { type: 'dataSafety' } : null)}
        />
      );
    }
    if (page.type === 'health') {
      return (
        <Health
          onBack={() => setPage({ type: 'dataSafety' })}
          onNavigate={(target) => {
            if (target === 'jobs') {
              setPage({ type: 'jobs' });
              return;
            }
            setPage(null);
            setTab(target);
          }}
        />
      );
    }
    if (page.type === 'privacy') {
      return <Privacy onBack={() => setPage({ type: 'dataSafety' })} />;
    }
    if (page.type === 'settlementDraft') {
      return (
        <SettlementDraftPage
          jobId={page.jobId}
          periodStart={page.periodStart}
          onAddEntry={(jobId, date) => openEntryEditor(jobId, date)}
          onOpenEntry={openEntryDetail}
          onBack={() => setPage(null)}
          onSettled={(settlementId) =>
            setPage({ type: 'settlementRecord', settlementId })
          }
        />
      );
    }
    return (
      <SettlementRecordPage
        settlementId={page.settlementId}
        onBack={() => {
          setPage(null);
          setTab('settlements');
        }}
      />
    );
  };

  if (!state.onboardingDone) {
    return (
      <>
        <Onboarding onOpenSnapshots={() => setPage({ type: 'snapshots' })} />
        {page ? (
          <div className="app-shell">
            <Suspense fallback={<PageLoading screen />}>{renderPage()}</Suspense>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="app-shell">
      {page ? (
        <Suspense fallback={<PageLoading screen />}>{renderPage()}</Suspense>
      ) : (
        <>
          <main className="app-main">
            <Suspense fallback={<PageLoading />}>{renderTab()}</Suspense>
          </main>
          {tab === 'home' ? <Fab onClick={() => openEntryEditor()} /> : null}
          <BottomNav
            active={tab}
            onChange={setTab}
            timerRunning={Boolean(state.activeTimer)}
          />
        </>
      )}

      {editor ? (
        <EntryEditor
          entryId={editor.entryId}
          initialJobId={editor.jobId}
          initialDate={editor.date}
          initialTimes={editor.initialTimes}
          onClose={() => setEditor(null)}
          onManageJobs={onManageJobsFromEditor}
        />
      ) : null}

      {detailId ? (
        <EntryDetail
          entryId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(entryId) => {
            setDetailId(null);
            setEditor({ entryId });
          }}
        />
      ) : null}
    </div>
  );
}
