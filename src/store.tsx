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
  RecurringRule,
  RestDay,
  Settlement,
  Settings,
  ToastAction,
  ToastTone,
  TrashKind,
} from './types';
import { nowISO, todayISO } from './lib/date';
import { createId } from './lib/id';
import {
  createEmptyState,
  loadStateDetailed,
  saveState,
  clearStoredState,
  isValidDate,
} from './lib/storage';
import {
  materializeRecurring,
  type NewRecurringRuleInput,
  type RecurringMaterializeOptions,
  type RecurringMaterializeResult,
} from './lib/recurring';
import {
  buildTrashRows,
  pushTrash,
  trashRestoreBlockReason,
} from './lib/trash';
import { createDemoState } from './lib/seed';
import { clearReminderMark } from './lib/reminder';
import { commitSettlement } from './lib/settlement';
import { findRestOnDay, wouldExceedDayLimit } from './lib/guards';
import { clearPhotos, deletePhoto, deletePhotos, prunePhotos } from './lib/photos';
import { PrivacyProvider } from './components/Money';
import { Toast } from './components/Toast';
import { StorageRecovery } from './components/StorageRecovery';

export type NewJobInput = Omit<Job, 'id' | 'createdAt' | 'archived'> & { archived?: boolean };
export type NewEntryInput = Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>;
export type EntryPatch = Partial<Omit<Entry, 'id' | 'createdAt' | 'settlementId'>>;

function validRecurringInput(
  state: AppState,
  input: NewRecurringRuleInput,
  options: { allowArchivedJob?: boolean } = {},
): boolean {
  const job = state.jobs.find(
    (item) => item.id === input.jobId && (options.allowArchivedJob || !item.archived),
  );
  if (!job || !isValidDate(input.startDate)) return false;
  if (input.frequency !== 'daily' && input.frequency !== 'weekly' && input.frequency !== 'monthly') {
    return false;
  }
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31) {
    return false;
  }
  if (!input.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) return false;
  if (input.endDate && (!isValidDate(input.endDate) || input.endDate < input.startDate)) {
    return false;
  }
  if (input.frequency === 'weekly' && input.weekdays.length === 0) return false;
  if (!Number.isFinite(input.hours) || input.hours < 0 || input.hours > 24) return false;
  if (job.rule.payType === 'hourly' && input.hours <= 0) return false;
  if (!Number.isFinite(input.quantity) || input.quantity < 0 || input.quantity > 1_000_000) {
    return false;
  }
  if (job.rule.payType === 'piece' && input.quantity <= 0) return false;
  return [input.bonus, input.deduction].every(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1_000_000,
  );
}

interface ToastState {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

export interface TrashActionResult {
  ok: boolean;
  reason?: string;
}

interface StoreValue {
  state: AppState;
  toast: (message: string, tone?: ToastTone, action?: ToastAction) => void;
  addJob: (input: NewJobInput) => Job;
  updateJob: (job: Job) => void;
  setJobArchived: (jobId: string, archived: boolean) => boolean;
  deleteJob: (jobId: string) => boolean;
  restoreJob: (jobId: string) => boolean;
  startTimer: (jobId: string) => boolean;
  clearTimer: () => void;
  addEntry: (input: NewEntryInput) => Entry | null;
  updateEntry: (entryId: string, patch: EntryPatch) => boolean;
  deleteEntry: (entryId: string) => boolean;
  restoreEntry: (entry: Entry) => boolean;
  addRestDay: (input: Omit<RestDay, 'id' | 'createdAt'>) => RestDay | null;
  removeRestDay: (restDayId: string) => boolean;
  restoreRestDay: (restDay: RestDay) => boolean;
  addAdvance: (input: Omit<Advance, 'id' | 'createdAt'>) => Advance | null;
  deleteAdvance: (advanceId: string) => boolean;
  addRecurringRule: (input: NewRecurringRuleInput) => RecurringRule | null;
  updateRecurringRule: (rule: RecurringRule) => boolean;
  deleteRecurringRule: (ruleId: string) => boolean;
  generateRecurring: (options?: RecurringMaterializeOptions) => RecurringMaterializeResult;
  restoreAdvance: (advance: Advance) => boolean;
  restoreTrashItem: (kind: TrashKind, id: string) => TrashActionResult;
  purgeTrashItem: (kind: TrashKind, id: string) => boolean;
  emptyTrash: () => number;
  settleJob: (
    jobId: string,
    period: Period,
    extraBonus: number,
    extraDeduction: number,
    note?: string,
    overRestEnabled?: boolean,
    overRestAmount?: number,
  ) => Settlement | null;
  setSettlementPayment: (
    settlementId: string,
    input: {
      paidAmount: number;
      paidAt?: string;
      method?: string;
      note?: string;
    },
  ) => boolean;
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
  const [initial] = useState(loadStateDetailed);
  if (initial.failure) return <StorageRecovery failure={initial.failure} />;
  return <StoreStateProvider initialState={initial.state}>{children}</StoreStateProvider>;
}

function StoreStateProvider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState: AppState | null;
}) {
  const [state, setState] = useState<AppState>(() => initialState ?? createEmptyState());
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);
  const stateRef = useRef(state);
  const storageWarned = useRef(false);
  stateRef.current = state;

  const toast = useCallback(
    (message: string, tone: ToastTone = 'success', action?: ToastAction) => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      const id = Date.now();
      setToastState({ id, message, tone, action });
      toastTimer.current = window.setTimeout(
        () => {
          setToastState((current) => (current?.id === id ? null : current));
        },
        action ? 5200 : 2800,
      );
    },
    [],
  );

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

  // 启动时清掉已经没有任何工记引用的照片，避免本机空间被孤儿照片占住。
  useEffect(() => {
    const current = stateRef.current;
    const keep = new Set<string>();
    for (const entry of current.entries) {
      if (entry.photoId) keep.add(entry.photoId);
    }
    for (const item of current.trashedEntries) {
      if (item.entry.photoId) keep.add(item.entry.photoId);
    }
    void prunePhotos(keep).catch(() => undefined);
  }, []);

  // 所有写操作共用同步 ref，避免同一事件循环内连续操作读取到旧账本。
  const commit = useCallback((updater: (previous: AppState) => AppState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
  }, []);

  const addJob = useCallback((input: NewJobInput) => {
    const job: Job = {
      ...input,
      id: createId('job'),
      archived: input.archived ?? false,
      createdAt: nowISO(),
    };
    commit((prev) => ({ ...prev, jobs: [...prev.jobs, job] }));
    return job;
  }, []);

  const updateJob = useCallback((job: Job) => {
    commit((prev) => ({
      ...prev,
      jobs: prev.jobs.map((item) => (item.id === job.id ? job : item)),
    }));
  }, []);

  const setJobArchived = useCallback((jobId: string, archived: boolean) => {
    const current = stateRef.current;
    if (archived && current.activeTimer?.jobId === jobId) return false;
    commit((prev) => ({
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
      current.settlements.some((settlement) => settlement.jobId === jobId) ||
      current.restDays.some((rest) => rest.jobId === jobId) ||
      Boolean(current.recurringRules?.some((rule) => rule.jobId === jobId));
    if (used) return false;
    const job = current.jobs.find((item) => item.id === jobId);
    if (!job) return false;
    commit((prev) => ({
      ...prev,
      jobs: prev.jobs.filter((item) => item.id !== jobId),
      trashedJobs: pushTrash(
        prev.trashedJobs,
        { job, deletedAt: nowISO() },
        (item) => item.job.id,
      ),
    }));
    return true;
  }, []);

  const restoreJob = useCallback((jobId: string) => {
    const current = stateRef.current;
    const trashed = current.trashedJobs.find((item) => item.job.id === jobId);
    if (!trashed) return false;
    if (current.jobs.some((job) => job.id === jobId)) {
      commit((prev) => ({
        ...prev,
        trashedJobs: prev.trashedJobs.filter((item) => item.job.id !== jobId),
      }));
      return true;
    }
    commit((prev) => ({
      ...prev,
      jobs: [...prev.jobs, trashed.job],
      trashedJobs: prev.trashedJobs.filter((item) => item.job.id !== jobId),
    }));
    return true;
  }, []);

  const startTimer = useCallback((jobId: string) => {
    const current = stateRef.current;
    if (current.activeTimer) return false;
    const job = current.jobs.find((item) => item.id === jobId);
    if (!job || job.archived || job.rule.payType === 'piece') return false;
    commit((prev) => ({
      ...prev,
      activeTimer: { jobId, startedAt: nowISO() },
    }));
    return true;
  }, []);

  const clearTimer = useCallback(() => {
    commit((prev) => ({ ...prev, activeTimer: null }));
  }, []);

  const addEntry = useCallback((input: NewEntryInput) => {
    const current = stateRef.current;
    const job = current.jobs.find((item) => item.id === input.jobId);
    if (!job || job.archived || !isValidDate(input.date)) return null;
    if (
      ![input.hours, input.quantity, input.otHours, input.bonus, input.deduction].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    ) {
      return null;
    }
    const settledPeriod = current.settlements.find(
      (settlement) =>
        settlement.jobId === input.jobId &&
        input.date >= settlement.periodStart &&
        input.date <= settlement.periodEnd,
    );
    if (settledPeriod) return null;
    if (wouldExceedDayLimit(current.entries, input.date, input.hours)) return null;
    const timestamp = nowISO();
    const entry: Entry = {
      ...input,
      id: createId('entry'),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    commit((prev) => {
      let trashedRests = prev.trashedRests;
      for (const restDay of prev.restDays) {
        if (restDay.jobId === entry.jobId && restDay.date === entry.date) {
          trashedRests = pushTrash(
            trashedRests,
            { restDay, deletedAt: timestamp },
            (item) => item.restDay.id,
          );
        }
      }
      return {
        ...prev,
        entries: [entry, ...prev.entries],
        restDays: prev.restDays.filter(
          (rest) => !(rest.jobId === entry.jobId && rest.date === entry.date),
        ),
        trashedRests,
      };
    });
    return entry;
  }, []);

  const updateEntry = useCallback((entryId: string, patch: EntryPatch) => {
    const current = stateRef.current;
    const existing = current.entries.find((entry) => entry.id === entryId);
    if (!existing) return false;
    if (existing.settlementId) return false;
    const targetJobId = patch.jobId ?? existing.jobId;
    const targetDate = patch.date ?? existing.date;
    const targetJob = current.jobs.find((job) => job.id === targetJobId);
    if (!targetJob || !isValidDate(targetDate)) return false;
    if (targetJob.archived && targetJobId !== existing.jobId) return false;
    if (
      [patch.hours, patch.quantity, patch.otHours, patch.bonus, patch.deduction].some(
        (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
      )
    ) {
      return false;
    }
    const targetSettled = current.settlements.some(
      (settlement) =>
        settlement.jobId === targetJobId &&
        targetDate >= settlement.periodStart &&
        targetDate <= settlement.periodEnd,
    );
    if (targetSettled) return false;
    const nextHours = patch.hours ?? existing.hours;
    if (wouldExceedDayLimit(current.entries, targetDate, nextHours, entryId)) return false;
    const timestamp = nowISO();
    commit((prev) => {
      let trashedRests = prev.trashedRests;
      for (const restDay of prev.restDays) {
        if (restDay.jobId === targetJobId && restDay.date === targetDate) {
          trashedRests = pushTrash(
            trashedRests,
            { restDay, deletedAt: timestamp },
            (item) => item.restDay.id,
          );
        }
      }
      return {
        ...prev,
        entries: prev.entries.map((entry) =>
          entry.id === entryId ? { ...entry, ...patch, updatedAt: timestamp } : entry,
        ),
        restDays: prev.restDays.filter(
          (rest) => !(rest.jobId === targetJobId && rest.date === targetDate),
        ),
        trashedRests,
      };
    });
    return true;
  }, []);

  const deleteEntry = useCallback((entryId: string) => {
    const existing = stateRef.current.entries.find((entry) => entry.id === entryId);
    if (!existing || existing.settlementId) return false;
    commit((prev) => ({
      ...prev,
      entries: prev.entries.filter((entry) => entry.id !== entryId),
      trashedEntries: pushTrash(
        prev.trashedEntries,
        { entry: existing, deletedAt: nowISO() },
        (item) => item.entry.id,
      ),
    }));
    return true;
  }, []);

  const restoreEntry = useCallback((entry: Entry) => {
    const current = stateRef.current;
    const dropTrash = (prev: AppState): AppState => ({
      ...prev,
      trashedEntries: prev.trashedEntries.filter((item) => item.entry.id !== entry.id),
    });
    if (current.entries.some((item) => item.id === entry.id)) {
      commit(dropTrash);
      return true;
    }
    if (entry.settlementId) return false;
    if (!current.jobs.some((job) => job.id === entry.jobId)) return false;
    const settled = current.settlements.some(
      (settlement) =>
        settlement.jobId === entry.jobId &&
        entry.date >= settlement.periodStart &&
        entry.date <= settlement.periodEnd,
    );
    if (settled) return false;
    if (findRestOnDay(current.restDays, entry.jobId, entry.date)) return false;
    if (wouldExceedDayLimit(current.entries, entry.date, entry.hours)) return false;
    commit((prev) => ({
      ...prev,
      entries: [entry, ...prev.entries],
      trashedEntries: prev.trashedEntries.filter((item) => item.entry.id !== entry.id),
    }));
    return true;
  }, []);

  const addRestDay = useCallback((input: Omit<RestDay, 'id' | 'createdAt'>) => {
    const current = stateRef.current;
    const job = current.jobs.find((item) => item.id === input.jobId);
    if (!job || job.archived || !isValidDate(input.date)) return null;
    const settledPeriod = current.settlements.find(
      (settlement) =>
        settlement.jobId === input.jobId &&
        input.date >= settlement.periodStart &&
        input.date <= settlement.periodEnd,
    );
    if (settledPeriod) return null;
    if (
      current.entries.some(
        (entry) => entry.jobId === input.jobId && entry.date === input.date,
      )
    ) {
      return null;
    }
    if (
      current.restDays.some(
        (rest) => rest.jobId === input.jobId && rest.date === input.date,
      )
    ) {
      return null;
    }
    const restDay: RestDay = {
      ...input,
      note: input.note?.trim() || undefined,
      id: createId('rest'),
      createdAt: nowISO(),
    };
    commit((prev) => ({ ...prev, restDays: [restDay, ...prev.restDays] }));
    return restDay;
  }, []);

  const removeRestDay = useCallback((restDayId: string) => {
    const current = stateRef.current;
    const existing = current.restDays.find((rest) => rest.id === restDayId);
    if (!existing) return false;
    const settled = current.settlements.some(
      (settlement) =>
        settlement.jobId === existing.jobId &&
        existing.date >= settlement.periodStart &&
        existing.date <= settlement.periodEnd,
    );
    if (settled) return false;
    commit((prev) => ({
      ...prev,
      restDays: prev.restDays.filter((rest) => rest.id !== restDayId),
      trashedRests: pushTrash(
        prev.trashedRests,
        { restDay: existing, deletedAt: nowISO() },
        (item) => item.restDay.id,
      ),
    }));
    return true;
  }, []);

  const restoreRestDay = useCallback((restDay: RestDay) => {
    const current = stateRef.current;
    if (current.restDays.some((rest) => rest.id === restDay.id)) {
      commit((prev) => ({
        ...prev,
        trashedRests: prev.trashedRests.filter((item) => item.restDay.id !== restDay.id),
      }));
      return true;
    }
    const job = current.jobs.find((item) => item.id === restDay.jobId);
    if (!job) return false;
    const settled = current.settlements.some(
      (settlement) =>
        settlement.jobId === restDay.jobId &&
        restDay.date >= settlement.periodStart &&
        restDay.date <= settlement.periodEnd,
    );
    if (settled) return false;
    if (
      current.entries.some(
        (entry) => entry.jobId === restDay.jobId && entry.date === restDay.date,
      )
    ) {
      return false;
    }
    if (
      current.restDays.some(
        (rest) => rest.jobId === restDay.jobId && rest.date === restDay.date,
      )
    ) {
      return false;
    }
    commit((prev) => ({
      ...prev,
      restDays: [restDay, ...prev.restDays],
      trashedRests: prev.trashedRests.filter((item) => item.restDay.id !== restDay.id),
    }));
    return true;
  }, []);

  const addAdvance = useCallback((input: Omit<Advance, 'id' | 'createdAt'>) => {
    const current = stateRef.current;
    const job = current.jobs.find((item) => item.id === input.jobId && !item.archived);
    if (!job || !isValidDate(input.date)) return null;
    if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000) {
      return null;
    }
    const alreadySettled = current.settlements.some(
      (settlement) =>
        settlement.jobId === input.jobId &&
        input.date >= settlement.periodStart &&
        input.date <= settlement.periodEnd,
    );
    if (alreadySettled) return null;
    const advance: Advance = {
      ...input,
      amount: Math.round(input.amount * 100) / 100,
      note: input.note?.trim() || undefined,
      id: createId('advance'),
      createdAt: nowISO(),
    };
    commit((prev) => ({ ...prev, advances: [advance, ...prev.advances] }));
    return advance;
  }, [commit]);

  const addRecurringRule = useCallback((input: NewRecurringRuleInput) => {
    const current = stateRef.current;
    if (!validRecurringInput(current, input)) return null;
    const timestamp = nowISO();
    const rule: RecurringRule = {
      ...input,
      weekdays: [...input.weekdays].sort((a, b) => a - b),
      note: input.note?.trim() || undefined,
      id: createId('recurring'),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    commit((prev) => ({
      ...prev,
      recurringRules: [rule, ...(prev.recurringRules ?? [])],
    }));
    return rule;
  }, [commit]);

  const updateRecurringRule = useCallback((rule: RecurringRule) => {
    const current = stateRef.current;
    const existing = current.recurringRules?.find((item) => item.id === rule.id);
    // 工作归档后仍允许关闭 / 修改规则，否则自动补记会变成关不掉的后台行为。
    if (!existing || !validRecurringInput(current, rule, {
      allowArchivedJob: rule.jobId === existing.jobId,
    })) return false;
    const scheduleChanged =
      existing.jobId !== rule.jobId ||
      existing.frequency !== rule.frequency ||
      existing.startDate !== rule.startDate ||
      existing.endDate !== rule.endDate ||
      existing.dayOfMonth !== rule.dayOfMonth ||
      existing.hours !== rule.hours ||
      existing.quantity !== rule.quantity ||
      existing.bonus !== rule.bonus ||
      existing.deduction !== rule.deduction ||
      existing.weekdays.join(',') !== rule.weekdays.join(',');
    commit((prev) => ({
      ...prev,
      recurringRules: (prev.recurringRules ?? []).map((item) =>
        item.id === rule.id
          ? {
              ...rule,
              note: rule.note?.trim() || undefined,
              weekdays: [...rule.weekdays].sort((a, b) => a - b),
              lastProcessedDate: scheduleChanged ? undefined : rule.lastProcessedDate,
              createdAt: existing.createdAt,
              updatedAt: nowISO(),
            }
          : item,
      ),
    }));
    return true;
  }, [commit]);

  const deleteRecurringRule = useCallback((ruleId: string) => {
    if (!stateRef.current.recurringRules?.some((rule) => rule.id === ruleId)) return false;
    commit((prev) => ({
      ...prev,
      recurringRules: (prev.recurringRules ?? []).filter((rule) => rule.id !== ruleId),
    }));
    return true;
  }, [commit]);

  const generateRecurring = useCallback(
    (options: RecurringMaterializeOptions = {}): RecurringMaterializeResult => {
      const result = materializeRecurring(stateRef.current, options);
      if (result.state !== stateRef.current) commit(() => result.state);
      return result;
    },
    [commit],
  );

  const deleteAdvance = useCallback((advanceId: string) => {
    const existing = stateRef.current.advances.find((advance) => advance.id === advanceId);
    if (!existing || existing.settlementId) return false;
    commit((prev) => ({
      ...prev,
      advances: prev.advances.filter((advance) => advance.id !== advanceId),
      trashedAdvances: pushTrash(
        prev.trashedAdvances,
        { advance: existing, deletedAt: nowISO() },
        (item) => item.advance.id,
      ),
    }));
    return true;
  }, []);

  const restoreAdvance = useCallback((advance: Advance) => {
    const current = stateRef.current;
    if (current.advances.some((item) => item.id === advance.id)) {
      commit((prev) => ({
        ...prev,
        trashedAdvances: prev.trashedAdvances.filter((item) => item.advance.id !== advance.id),
      }));
      return true;
    }
    if (advance.settlementId) return false;
    if (!current.jobs.some((job) => job.id === advance.jobId)) return false;
    const settled = current.settlements.some(
      (settlement) =>
        settlement.jobId === advance.jobId &&
        advance.date >= settlement.periodStart &&
        advance.date <= settlement.periodEnd,
    );
    if (settled) return false;
    commit((prev) => ({
      ...prev,
      advances: [advance, ...prev.advances],
      trashedAdvances: prev.trashedAdvances.filter((item) => item.advance.id !== advance.id),
    }));
    return true;
  }, []);

  const restoreTrashItem = useCallback((kind: TrashKind, id: string): TrashActionResult => {
    const current = stateRef.current;
    if (kind === 'job') {
      const item = current.trashedJobs.find((value) => value.job.id === id);
      if (!item) {
        return current.jobs.some((job) => job.id === id)
          ? { ok: true }
          : { ok: false, reason: '这条工作已经不在回收站里了' };
      }
      commit((prev) => ({
        ...prev,
        jobs: prev.jobs.some((job) => job.id === id) ? prev.jobs : [...prev.jobs, item.job],
        trashedJobs: prev.trashedJobs.filter((value) => value.job.id !== id),
      }));
      return { ok: true };
    }

    const row = buildTrashRows(current).find((item) => item.kind === kind && item.id === id);
    if (!row) return { ok: false, reason: '这条记录已经不在回收站里了' };
    const reason = trashRestoreBlockReason(row, current);
    if (reason) return { ok: false, reason };

    if (kind === 'entry') {
      const item = current.trashedEntries.find((value) => value.entry.id === id);
      if (!item) return { ok: false, reason: '这条工记已经不在回收站里了' };
      if (item.entry.settlementId) {
        return { ok: false, reason: '这笔工记已结算，先撤销结算再恢复' };
      }
      commit((prev) => ({
        ...prev,
        entries: prev.entries.some((entry) => entry.id === id)
          ? prev.entries
          : [item.entry, ...prev.entries],
        trashedEntries: prev.trashedEntries.filter((value) => value.entry.id !== id),
      }));
      return { ok: true };
    }

    if (kind === 'rest') {
      const item = current.trashedRests.find((value) => value.restDay.id === id);
      if (!item) return { ok: false, reason: '这条休息已经不在回收站里了' };
      commit((prev) => ({
        ...prev,
        restDays: prev.restDays.some((rest) => rest.id === id)
          ? prev.restDays
          : [item.restDay, ...prev.restDays],
        trashedRests: prev.trashedRests.filter((value) => value.restDay.id !== id),
      }));
      return { ok: true };
    }

    const item = current.trashedAdvances.find((value) => value.advance.id === id);
    if (!item) return { ok: false, reason: '这条借支已经不在回收站里了' };
    commit((prev) => ({
      ...prev,
      advances: prev.advances.some((advance) => advance.id === id)
        ? prev.advances
        : [item.advance, ...prev.advances],
      trashedAdvances: prev.trashedAdvances.filter((value) => value.advance.id !== id),
    }));
    return { ok: true };
  }, []);

  const purgeTrashItem = useCallback((kind: TrashKind, id: string) => {
    const current = stateRef.current;
    const exists =
      kind === 'job'
        ? current.trashedJobs.some((item) => item.job.id === id)
        : kind === 'entry'
          ? current.trashedEntries.some((item) => item.entry.id === id)
          : kind === 'rest'
            ? current.trashedRests.some((item) => item.restDay.id === id)
            : current.trashedAdvances.some((item) => item.advance.id === id);
    if (!exists) return false;
    if (kind === 'job') {
      const photoIds = current.trashedEntries
        .filter((item) => item.entry.jobId === id)
        .map((item) => item.entry.photoId)
        .filter((value): value is string => Boolean(value));
      if (photoIds.length > 0) void deletePhotos(photoIds).catch(() => undefined);
    }
    if (kind === 'entry') {
      const photoId = current.trashedEntries.find((item) => item.entry.id === id)?.entry.photoId;
      if (photoId) void deletePhoto(photoId).catch(() => undefined);
    }
    commit((prev) => {
      if (kind === 'job') {
        return {
          ...prev,
          trashedJobs: prev.trashedJobs.filter((item) => item.job.id !== id),
          trashedEntries: prev.trashedEntries.filter((item) => item.entry.jobId !== id),
          trashedRests: prev.trashedRests.filter((item) => item.restDay.jobId !== id),
          trashedAdvances: prev.trashedAdvances.filter((item) => item.advance.jobId !== id),
        };
      }
      if (kind === 'entry') {
        return {
          ...prev,
          trashedEntries: prev.trashedEntries.filter((item) => item.entry.id !== id),
        };
      }
      if (kind === 'rest') {
        return {
          ...prev,
          trashedRests: prev.trashedRests.filter((item) => item.restDay.id !== id),
        };
      }
      return {
        ...prev,
        trashedAdvances: prev.trashedAdvances.filter((item) => item.advance.id !== id),
      };
    });
    return true;
  }, []);

  const emptyTrash = useCallback(() => {
    const current = stateRef.current;
    const count =
      current.trashedJobs.length +
      current.trashedEntries.length +
      current.trashedRests.length +
      current.trashedAdvances.length;
    if (count === 0) return 0;
    const photoIds = current.trashedEntries
      .map((item) => item.entry.photoId)
      .filter((value): value is string => Boolean(value));
    if (photoIds.length > 0) void deletePhotos(photoIds).catch(() => undefined);
    commit((prev) => ({
      ...prev,
      trashedJobs: [],
      trashedEntries: [],
      trashedRests: [],
      trashedAdvances: [],
    }));
    return count;
  }, []);

  const settleJob = useCallback(
    (
      jobId: string,
      period: Period,
      extraBonus: number,
      extraDeduction: number,
      note?: string,
      overRestEnabled = true,
      overRestAmount?: number,
    ) => {
      const committed = commitSettlement(stateRef.current, {
        jobId,
        period,
        extraBonus,
        extraDeduction,
        note,
        overRestEnabled,
        overRestAmount,
        settlementId: createId('settlement'),
        createdAt: nowISO(),
      });
      if (!committed) return null;
      // 同步推进 ref，避免同一渲染周期内第二次调用仍读取旧状态。
      stateRef.current = committed.state;
      setState(committed.state);
      return committed.settlement;
    },
    [],
  );

  const setSettlementPayment = useCallback(
    (
      settlementId: string,
      input: {
        paidAmount: number;
        paidAt?: string;
        method?: string;
        note?: string;
      },
    ) => {
      const current = stateRef.current;
      const settlement = current.settlements.find((item) => item.id === settlementId);
      if (!settlement) return false;
      const net = Math.max(0, settlement.net);
      const paid = Math.min(net, Math.max(0, Math.round(input.paidAmount * 100) / 100));
      const paymentStatus = paid <= 0 ? 'unpaid' : paid >= net ? 'paid' : 'partial';
      commit((prev) => ({
        ...prev,
        settlements: prev.settlements.map((item) =>
          item.id === settlementId
            ? {
                ...item,
                paymentStatus,
                paidAmount: paid,
                paidAt: paid > 0 ? input.paidAt || todayISO() : undefined,
                paymentMethod: paid > 0 ? input.method?.trim() || undefined : undefined,
                paymentNote: paid > 0 ? input.note?.trim() || undefined : undefined,
              }
            : item,
        ),
      }));
      return true;
    },
    [],
  );

  const undoSettlement = useCallback((settlementId: string) => {
    const current = stateRef.current;
    if (!current.settlements.some((settlement) => settlement.id === settlementId)) return false;
    commit((prev) => ({
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
    commit((prev) => ({ ...prev, profile: { ...prev.profile, ...patch } }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    commit((prev) => {
      const next: Settings = {
        ...prev.settings,
        ...patch,
        reminder: patch.reminder
          ? { ...prev.settings.reminder, ...patch.reminder }
          : prev.settings.reminder,
        budget: patch.budget
          ? { ...prev.settings.budget, ...patch.budget }
          : prev.settings.budget,
      };
      return { ...prev, settings: next };
    });
  }, []);

  const replaceState = useCallback(
    (next: AppState) => {
      commit(() => ({
        ...next,
        onboardingDone: next.onboardingDone || next.jobs.length > 0,
      }));
    },
    [commit],
  );

  const resetAll = useCallback(() => {
    clearStoredState();
    clearReminderMark();
    void clearPhotos().catch(() => undefined);
    commit(() => createEmptyState());
  }, [commit]);

  const loadDemo = useCallback(() => {
    commit(() => createDemoState());
  }, [commit]);

  const completeOnboarding = useCallback((name: string, input: NewJobInput) => {
    const timestamp = nowISO();
    const job: Job = {
      ...input,
      id: createId('job'),
      archived: false,
      createdAt: timestamp,
    };
    commit((prev) => ({
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
    restoreJob,
    startTimer,
    clearTimer,
    addEntry,
    updateEntry,
    deleteEntry,
    restoreEntry,
    addRestDay,
    removeRestDay,
    restoreRestDay,
    addAdvance,
    deleteAdvance,
    addRecurringRule,
    updateRecurringRule,
    deleteRecurringRule,
    generateRecurring,
    restoreAdvance,
    restoreTrashItem,
    purgeTrashItem,
    emptyTrash,
    settleJob,
    setSettlementPayment,
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
