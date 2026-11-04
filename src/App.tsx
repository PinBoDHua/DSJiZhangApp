import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './store';
import { BottomNav, type TabKey } from './components/BottomNav';
import { Fab } from './components/Fab';
import { EntryDetail } from './components/EntryDetail';
import { Home } from './pages/Home';
import { Records } from './pages/Records';
import { Settlements } from './pages/Settlements';
import { Stats } from './pages/Stats';
import { Profile } from './pages/Profile';
import { Jobs } from './pages/Jobs';
import { JobEditor } from './pages/JobEditor';
import { SettlementDraftPage, SettlementRecordPage } from './pages/SettlementPage';
import { EntryEditor } from './pages/EntryEditor';
import { Onboarding } from './pages/Onboarding';
import type { TimerTimes } from './lib/timer';
import { useTheme } from './hooks/useTheme';
import { useReminder } from './hooks/useReminder';
import { todayISO } from './lib/date';

type Page =
  | { type: 'jobs' }
  | { type: 'jobEditor'; jobId?: string }
  | { type: 'settlementDraft'; jobId: string; periodStart: string }
  | { type: 'settlementRecord'; settlementId: string };

interface EditorState {
  entryId?: string;
  jobId?: string;
  initialTimes?: TimerTimes;
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
  useTheme(state.settings.theme);
  const todayEntryCount = state.entries.filter((entry) => entry.date === todayISO()).length;
  useReminder(state.settings.reminder, todayEntryCount);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [tab, state.onboardingDone]);

  if (!state.onboardingDone) {
    return <Onboarding />;
  }

  const openEntryEditor = (jobId?: string) => {
    setEditor({ jobId });
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
          onOpenEntry={openEntryDetail}
          onOpenJobs={openJobs}
          onGoRecords={() => setTab('records')}
          onGoSettlements={() => setTab('settlements')}
          onOpenProfile={() => setTab('profile')}
          onFinishTimer={(jobId, times) => setEditor({ jobId, initialTimes: times })}
        />
      );
    }
    if (tab === 'records') {
      return (
        <Records
          onAddEntry={() => openEntryEditor()}
          onOpenEntry={openEntryDetail}
          onOpenJobs={openJobs}
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
    return <Profile onOpenJobs={openJobs} />;
  };

  const renderPage = () => {
    if (!page) return null;
    if (page.type === 'jobs') {
      return (
        <Jobs
          onBack={() => setPage(null)}
          onAdd={() => setPage({ type: 'jobEditor' })}
          onEdit={(jobId) => setPage({ type: 'jobEditor', jobId })}
        />
      );
    }
    if (page.type === 'jobEditor') {
      return (
        <JobEditor
          key={page.jobId ?? 'new'}
          jobId={page.jobId}
          onBack={() => setPage({ type: 'jobs' })}
        />
      );
    }
    if (page.type === 'settlementDraft') {
      return (
        <SettlementDraftPage
          jobId={page.jobId}
          periodStart={page.periodStart}
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

  return (
    <div className="app-shell">
      {page ? (
        renderPage()
      ) : (
        <>
          <main className="app-main">{renderTab()}</main>
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
