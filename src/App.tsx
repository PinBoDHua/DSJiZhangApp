import { lazy, Suspense, useEffect, useState } from 'react';
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
import { todayISO } from './lib/date';
import { pushNativeBack } from './lib/nativeBack';
import { schedulePaydayNotifications } from './lib/paydayNotifications';
import { cancelDailyReminder, syncDailyReminder } from './lib/nativeReminders';
import { isNativeApp } from './lib/native';

const Records = lazy(() => import('./pages/Records').then((module) => ({ default: module.Records })));
const Settlements = lazy(() =>
  import('./pages/Settlements').then((module) => ({ default: module.Settlements })),
);
const Stats = lazy(() => import('./pages/Stats').then((module) => ({ default: module.Stats })));
const Profile = lazy(() =>
  import('./pages/Profile').then((module) => ({ default: module.Profile })),
);
const Jobs = lazy(() => import('./pages/Jobs').then((module) => ({ default: module.Jobs })));
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

type Page =
  | { type: 'jobs' }
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
  const { state } = useStore();
  const [tab, setTab] = useState<TabKey>('home');
  const [page, setPage] = useState<Page | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [privacyOk, setPrivacyOk] = useState(() => hasPrivacyConsent());
  useTheme(state.settings.theme);
  const todayEntryCount = state.entries.filter((entry) => entry.date === todayISO()).length;
  useReminder(state.settings.reminder, todayEntryCount);
  useAutoSnapshot(state, privacyOk);

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
          onOpenAttendance={(jobId) => setPage({ type: 'attendance', jobId })}
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
