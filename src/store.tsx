import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type {
  Advance,
  AppState,
  Entry,
  Job,
  Period,
  Profile,
  Settlement,
  Settings,
  ToastTone,
} from './types';
import { nowISO } from './lib/date';
import { createId } from './lib/id';
import { createEmptyState, loadState, saveState, clearStoredState } from './lib/storage';
import { createDemoState } from './lib/seed';
import { clearReminderMark } from './lib/reminder';
import { buildSettlementDraft, makeSettlement } from './lib/settlement';
import { PrivacyProvider } from './components/Money';
import { Toast } from './components/Toast';

export type NewJobInput = Omit<Job, 'id' | 'createdAt' | 'archived'> & { archived?: boolean };
export type NewEntryInput = Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>;
export type EntryPatch = Partial<Omit<Entry, 'id' | 'createdAt' | 'settlementId'>>;

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
}

interface StoreValue {
  state: AppState;
  toast: (message: string, tone?: ToastTone) => void;
  addJob: (input: NewJobInput) => Job;
  updateJob: (job: Job) => void;
  setJobArchived: (jobId: string, archived: boolean) => boolean;
  deleteJob: (jobId: string) => boolean;
  startTimer: (jobId: string) => boolean;
  clearTimer: () => void;
  addEntry: (input: NewEntryInput) => Entry | null;
  updateEntry: (entryId: string, patch: EntryPatch) => boolean;
  deleteEntry: (entryId: string) => boolean;
  addAdvance: (input: Omit<Advance, 'id' | 'createdAt'>) => Advance;
  deleteAdvance: (advanceId: string) => boolean;
  settleJob: (
    jobId: string,
    period: Period,
    extraBonus: number,
    extraDeduction: number,
    note?: string,
  ) => Settlement | null;
  undoSettlement: (settlementId: string) => boolean;
  updateProfile: (patch: Partial<Profile>) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  replaceState: (state: AppState) => void;
  resetAll: () => void;
  loadDemo: () => void;
  completeOnboarding: (name: string, input: NewJobInput) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => loadState() ?? createEmptyState());
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);
  const stateRef = useRef(state);
  const storageWarned = useRef(false);
  stateRef.current = state;

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    const id = Date.now();
    setToastState({ id, message, tone });
    toastTimer.current = window.setTimeout(() => {
      setToastState((current) => (current?.id === id ? null : current));
    }, 2800);
  }, []);

  useEffect(() => {
    try {
      saveState(state);
      storageWarned.current = false;
    } catch (error) {
      console.warn('保存本地数据失败', error);
      if (!storageWarned.current) {
        storageWarned.current = true;
        toast('本地存储空间不足，请先导出备份', 'error');
      }
    }
  }, [state, toast]);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const addJob = useCallback((input: NewJobInput) => {
    const job: Job = {
      ...input,
      id: createId('job'),
      archived: input.archived ?? false,
      createdAt: nowISO(),
    };
    setState((prev) => ({ ...prev, jobs: [...prev.jobs, job] }));
    return job;
  }, []);

  const updateJob = useCallback((job: Job) => {
    setState((prev) => ({
      ...prev,
      jobs: prev.jobs.map((item) => (item.id === job.id ? job : item)),
    }));
  }, []);

  const setJobArchived = useCallback((jobId: string, archived: boolean) => {
    const current = stateRef.current;
    if (archived && current.activeTimer?.jobId === jobId) return false;
    setState((prev) => ({
      ...prev,
      jobs: prev.jobs.map((job) => (job.id === jobId ? { ...job, archived } : job)),
    }));
    return true;
  }, []);

  const deleteJob = useCallback((jobId: string) => {
    const current = stateRef.current;
    if (current.activeTimer?.jobId === jobId) return false;
    const used =
      current.entries.some((entry) => entry.jobId === jobId) ||
      current.advances.some((advance) => advance.jobId === jobId) ||
      current.settlements.some((settlement) => settlement.jobId === jobId);
    if (used) return false;
    setState((prev) => ({ ...prev, jobs: prev.jobs.filter((job) => job.id !== jobId) }));
    return true;
  }, []);

  const startTimer = useCallback((jobId: string) => {
    const current = stateRef.current;
    if (current.activeTimer) return false;
    const job = current.jobs.find((item) => item.id === jobId);
    if (!job || job.archived) return false;
    setState((prev) => ({
      ...prev,
      activeTimer: { jobId, startedAt: nowISO() },
    }));
    return true;
  }, []);

  const clearTimer = useCallback(() => {
    setState((prev) => ({ ...prev, activeTimer: null }));
  }, []);

  const addEntry = useCallback((input: NewEntryInput) => {
    const current = stateRef.current;
    const settledPeriod = current.settlements.find(
      (settlement) =>
        settlement.jobId === input.jobId &&
        input.date >= settlement.periodStart &&
        input.date <= settlement.periodEnd,
    );
    if (settledPeriod) return null;
    const timestamp = nowISO();
    const entry: Entry = {
      ...input,
      id: createId('entry'),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    setState((prev) => ({ ...prev, entries: [entry, ...prev.entries] }));
    return entry;
  }, []);

  const updateEntry = useCallback((entryId: string, patch: EntryPatch) => {
    const current = stateRef.current;
    const existing = current.entries.find((entry) => entry.id === entryId);
    if (!existing) return false;
    if (existing.settlementId) return false;
    const targetJobId = patch.jobId ?? existing.jobId;
    const targetDate = patch.date ?? existing.date;
    const targetSettled = current.settlements.some(
      (settlement) =>
        settlement.jobId === targetJobId &&
        targetDate >= settlement.periodStart &&
        targetDate <= settlement.periodEnd,
    );
    if (targetSettled) return false;
    setState((prev) => ({
      ...prev,
      entries: prev.entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch, updatedAt: nowISO() } : entry,
      ),
    }));
    return true;
  }, []);

  const deleteEntry = useCallback((entryId: string) => {
    const existing = stateRef.current.entries.find((entry) => entry.id === entryId);
    if (!existing || existing.settlementId) return false;
    setState((prev) => ({
      ...prev,
      entries: prev.entries.filter((entry) => entry.id !== entryId),
    }));
    return true;
  }, []);

  const addAdvance = useCallback((input: Omit<Advance, 'id' | 'createdAt'>) => {
    const advance: Advance = {
      ...input,
      id: createId('advance'),
      createdAt: nowISO(),
    };
    setState((prev) => ({ ...prev, advances: [advance, ...prev.advances] }));
    return advance;
  }, []);

  const deleteAdvance = useCallback((advanceId: string) => {
    const existing = stateRef.current.advances.find((advance) => advance.id === advanceId);
    if (!existing || existing.settlementId) return false;
    setState((prev) => ({
      ...prev,
      advances: prev.advances.filter((advance) => advance.id !== advanceId),
    }));
    return true;
  }, []);

  const settleJob = useCallback(
    (
      jobId: string,
      period: Period,
      extraBonus: number,
      extraDeduction: number,
      note?: string,
    ) => {
      const current = stateRef.current;
      const job = current.jobs.find((item) => item.id === jobId);
      if (!job) return null;
      const draft = buildSettlementDraft(
        job,
        current.entries,
        current.advances,
        period,
        extraBonus,
        extraDeduction,
      );
      if (draft.entries.length === 0) return null;
      const settlement = makeSettlement(draft, createId('settlement'), nowISO(), note?.trim() || undefined);
      setState((prev) => ({
        ...prev,
        settlements: [settlement, ...prev.settlements],
        entries: prev.entries.map((entry) =>
          draft.entryIds.includes(entry.id)
            ? { ...entry, settlementId: settlement.id, updatedAt: nowISO() }
            : entry,
        ),
        advances: prev.advances.map((advance) =>
          draft.advanceIds.includes(advance.id)
            ? { ...advance, settlementId: settlement.id }
            : advance,
        ),
      }));
      return settlement;
    },
    [],
  );

  const undoSettlement = useCallback((settlementId: string) => {
    const current = stateRef.current;
    if (!current.settlements.some((settlement) => settlement.id === settlementId)) return false;
    setState((prev) => ({
      ...prev,
      settlements: prev.settlements.filter((settlement) => settlement.id !== settlementId),
      entries: prev.entries.map((entry) =>
        entry.settlementId === settlementId ? { ...entry, settlementId: undefined } : entry,
      ),
      advances: prev.advances.map((advance) =>
        advance.settlementId === settlementId ? { ...advance, settlementId: undefined } : advance,
      ),
    }));
    return true;
  }, []);

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setState((prev) => ({ ...prev, profile: { ...prev.profile, ...patch } }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((prev) => {
      const next: Settings = {
        ...prev.settings,
        ...patch,
        reminder: patch.reminder
          ? { ...prev.settings.reminder, ...patch.reminder }
          : prev.settings.reminder,
      };
      return { ...prev, settings: next };
    });
  }, []);

  const replaceState = useCallback(
    (next: AppState) => {
      setState({
        ...next,
        onboardingDone: next.onboardingDone || next.jobs.length > 0,
      });
    },
    [],
  );

  const resetAll = useCallback(() => {
    clearStoredState();
    clearReminderMark();
    setState(createEmptyState());
  }, []);

  const loadDemo = useCallback(() => {
    setState(createDemoState());
  }, []);

  const completeOnboarding = useCallback((name: string, input: NewJobInput) => {
    const timestamp = nowISO();
    const job: Job = {
      ...input,
      id: createId('job'),
      archived: false,
      createdAt: timestamp,
    };
    setState((prev) => ({
      ...prev,
      profile: { ...prev.profile, name: name.trim() || '工友' },
      jobs: [...prev.jobs, job],
      onboardingDone: true,
    }));
  }, []);

  const value: StoreValue = {
    state,
    toast,
    addJob,
    updateJob,
    setJobArchived,
    deleteJob,
    startTimer,
    clearTimer,
    addEntry,
    updateEntry,
    deleteEntry,
    addAdvance,
    deleteAdvance,
    settleJob,
    undoSettlement,
    updateProfile,
    updateSettings,
    replaceState,
    resetAll,
    loadDemo,
    completeOnboarding,
  };

  return (
    <StoreContext.Provider value={value}>
      <PrivacyProvider hidden={state.profile.hideAmounts}>{children}</PrivacyProvider>
      <Toast toast={toastState} onClose={() => setToastState(null)} />
    </StoreContext.Provider>
  );
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore 必须在 StoreProvider 内使用');
  return context;
}
