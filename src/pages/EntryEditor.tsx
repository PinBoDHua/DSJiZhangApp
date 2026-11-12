import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Banknote,
  Briefcase,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock3,
  LockKeyhole,
  Sun,
  X,
} from 'lucide-react';
import type { Entry, Job, PayRule } from '../types';
import { useStore } from '../store';
import {
  addDays,
  formatDateCompact,
  formatDateFull,
  hoursBetween,
  isWeekend,
  todayISO,
} from '../lib/date';
import { formatHours } from '../lib/money';
import { round2, toAmount } from '../lib/money';
import { autoOtHours, otHourlyRate, otMultiplierFor, payForEntry } from '../lib/pay';
import type { TimerTimes } from '../lib/timer';
import { DURATION_PRESETS, endTimeForDuration } from '../lib/timePreset';
import { findRestOnDay } from '../lib/guards';
import { createPhotoId, deletePhoto, getPhoto, putPhoto } from '../lib/photos';
import { createWatermarkedPhoto } from '../lib/photoStamp';
import { EmptyState } from '../components/EmptyState';
import { JobDot } from '../components/JobDot';
import { Money } from '../components/Money';
import { Sheet } from '../components/Sheet';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface EntryEditorProps {
  entryId?: string;
  initialJobId?: string;
  initialDate?: string;
  initialTimes?: TimerTimes;
  onClose: () => void;
  onManageJobs: () => void;
}

type TimeMode = 'range' | 'manual';

export function EntryEditor({
  entryId,
  initialJobId,
  initialDate,
  initialTimes,
  onClose,
  onManageJobs,
}: EntryEditorProps) {
  const { state, addEntry, updateEntry, toast } = useStore();
  const existing = entryId ? state.entries.find((entry) => entry.id === entryId) : undefined;
  const initialTimerHours = initialTimes
    ? hoursBetween(initialTimes.startTime, initialTimes.endTime, initialTimes.breakMinutes)
    : null;
  const selectableJobs = state.jobs.filter(
    (job) => !job.archived || job.id === existing?.jobId,
  );
  const lastUsedJobId = [...state.entries].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0]?.jobId;
  const preferredJobId =
    existing?.jobId ??
    (initialJobId && selectableJobs.some((job) => job.id === initialJobId)
      ? initialJobId
      : lastUsedJobId && selectableJobs.some((job) => job.id === lastUsedJobId)
        ? lastUsedJobId
        : selectableJobs[0]?.id ?? '');
  const preferredJob = state.jobs.find((job) => job.id === preferredJobId);
  const initialPayType = existing?.rule.payType ?? preferredJob?.rule.payType ?? 'hourly';
  const initialShiftHours =
    preferredJob && preferredJob.rule.payType === 'monthly' && preferredJob.rule.monthlyMode === 'fixed'
      ? hoursBetween(
          preferredJob.shift.startTime,
          preferredJob.shift.endTime,
          preferredJob.shift.breakMinutes,
        )
      : 8;

  const [jobId, setJobId] = useState(preferredJobId);
  const [date, setDate] = useState(
    existing?.date ?? initialTimes?.date ?? initialDate ?? todayISO(),
  );
  const [timeMode, setTimeMode] = useState<TimeMode>(
    existing ? (existing.startTime && existing.endTime ? 'range' : 'manual') : 'range',
  );
  const [startTime, setStartTime] = useState(
    existing?.startTime ?? initialTimes?.startTime ?? preferredJob?.shift.startTime ?? '08:00',
  );
  const [endTime, setEndTime] = useState(
    existing?.endTime ?? initialTimes?.endTime ?? preferredJob?.shift.endTime ?? '17:00',
  );
  const [breakMinutes, setBreakMinutes] = useState(
    existing?.breakMinutes ??
      initialTimes?.breakMinutes ??
      preferredJob?.shift.breakMinutes ??
      60,
  );
  const [manualHours, setManualHours] = useState(
    existing
      ? String(existing.hours)
      : initialTimerHours !== null
        ? String(initialTimerHours)
        : initialPayType === 'piece'
          ? '0'
          : initialPayType === 'monthly' && preferredJob?.rule.monthlyMode === 'fixed'
            ? String(initialShiftHours)
            : '8',
  );
  const [quantity, setQuantity] = useState(existing ? String(existing.quantity) : '');
  const [otHoursInput, setOtHoursInput] = useState(
    existing && existing.rule.payType !== 'hourly' ? String(existing.otHours) : '0',
  );
  const [bonus, setBonus] = useState(existing ? String(existing.bonus) : '');
  const [deduction, setDeduction] = useState(existing ? String(existing.deduction) : '');
  const [holiday, setHoliday] = useState(existing?.holiday ?? false);
  const [note, setNote] = useState(existing?.note ?? '');
  const [moreOpen, setMoreOpen] = useState(
    Boolean(existing && (existing.bonus > 0 || existing.deduction > 0 || existing.note)),
  );
  const [error, setError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const [photoDraft, setPhotoDraft] = useState<string | null>(null);
  const [photoTouched, setPhotoTouched] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const jobPickerRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoChangedRef = useRef(false);
  const submittingRef = useRef(false);
  // 计时结束带出的工记：计时器已清除，直接关闭会丢工时，预置脏标记让关闭走确认。
  const dirtyRef = useRef(!entryId && Boolean(initialTimes));
  const afterDiscardRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const picker = jobPickerRef.current;
      const active = picker?.querySelector<HTMLElement>('.job-choice.is-active');
      if (!picker || !active) return;
      const pickerRect = picker.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      if (activeRect.right > pickerRect.right - 2) {
        picker.scrollLeft = picker.scrollWidth;
      } else if (activeRect.left < pickerRect.left) {
        picker.scrollLeft = 0;
      }
    }, 140);
    return () => window.clearTimeout(timer);
  }, [jobId]);

  useEffect(() => {
    const photoId = existing?.photoId;
    if (!photoId || photoChangedRef.current) return;
    let active = true;
    getPhoto(photoId)
      .then((photo) => {
        if (!active || photoChangedRef.current) return;
        if (photo) setPhotoDraft(photo.dataUrl);
        else setPhotoError('照片不在本机，可能来自另一台设备');
      })
      .catch(() => {
        if (active && !photoChangedRef.current) {
          setPhotoError('照片不在本机，可能来自另一台设备');
        }
      });
    return () => {
      active = false;
    };
  }, [existing?.photoId]);

  const selectedJob: Job | undefined = selectableJobs.find((job) => job.id === jobId);
  const rule: PayRule | undefined =
    existing && existing.jobId === jobId ? existing.rule : selectedJob?.rule;
  const payType = rule?.payType ?? 'hourly';
  const isHourly = payType === 'hourly';
  const isMonthly = payType === 'monthly';
  const isFixedMonthly = isMonthly && rule?.monthlyMode === 'fixed';
  const isPiece = payType === 'piece';
  const isFixedDay = !isHourly && !isPiece;

  const workedHours = hoursBetween(startTime, endTime, 0);
  const netHours = hoursBetween(startTime, endTime, breakMinutes);
  const manualHoursValue = Math.max(0, toAmount(manualHours));
  const quantityValue = Math.max(0, toAmount(quantity));
  const hours = isHourly
    ? timeMode === 'range'
      ? netHours
      : manualHoursValue
    : manualHoursValue;

  const autoOt = isHourly && rule?.otEnabled ? autoOtHours(hours, rule) : 0;
  const enteredOt =
    isFixedDay && rule?.otEnabled ? Math.max(0, toAmount(otHoursInput)) : 0;
  const effectiveOt = isHourly ? autoOt : enteredOt;
  const multiplier = isPiece
    ? 1
    : rule?.otEnabled
      ? otMultiplierFor(date, holiday, rule)
      : 1;
  const overtimeEnabled = Boolean(rule?.otEnabled && !isPiece);

  const previewEntry: Entry | null = rule
    ? {
        id: 'preview',
        jobId,
        date,
        startTime: isHourly && timeMode === 'range' ? startTime : existing?.startTime,
        endTime: isHourly && timeMode === 'range' ? endTime : existing?.endTime,
        breakMinutes: isHourly && timeMode === 'range' ? breakMinutes : 0,
        hours,
        quantity: isPiece ? quantityValue : 0,
        otHours: effectiveOt,
        bonus: Math.max(0, toAmount(bonus)),
        deduction: Math.max(0, toAmount(deduction)),
        holiday: overtimeEnabled && holiday,
        note,
        rule,
        createdAt: '',
        updatedAt: '',
      }
    : null;
  const previewPay = previewEntry ? payForEntry(previewEntry) : null;

  const multiplierText = Number.isInteger(multiplier)
    ? String(multiplier)
    : multiplier.toFixed(1);

  const quickDates = [
    { offset: 0, label: '今天' },
    { offset: 1, label: '昨天' },
    { offset: 2, label: '前天' },
  ].map((item) => ({ ...item, iso: addDays(todayISO(), -item.offset) }));
  const isQuickDate = quickDates.some((item) => item.iso === date);

  const showError = (message: string) => {
    setError(message);
  };

  const pickPhoto = () => {
    photoInputRef.current?.click();
  };

  const handlePhotoFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    photoChangedRef.current = true;
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const dataUrl = await createWatermarkedPhoto(file, {
        jobName: selectedJob?.name ?? '未命名工作',
        date,
        hours,
      });
      setPhotoDraft(dataUrl);
      setPhotoTouched(true);
      dirtyRef.current = true;
    } catch (photoFailure) {
      setPhotoError(
        photoFailure instanceof Error ? photoFailure.message : '照片处理失败，请重试',
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = () => {
    photoChangedRef.current = true;
    setPhotoDraft(null);
    setPhotoTouched(true);
    setPhotoError('');
    dirtyRef.current = true;
  };

  const chooseJob = (job: Job) => {
    dirtyRef.current = true;
    setJobId(job.id);
    setError('');
    if (!existing && !initialTimes) {
      setStartTime(job.shift.startTime);
      setEndTime(job.shift.endTime);
      setBreakMinutes(job.shift.breakMinutes);
    }
    if (!existing) {
      if (job.rule.payType === 'piece' && manualHours === '8') setManualHours('0');
      if (
        job.rule.payType === 'monthly' &&
        job.rule.monthlyMode === 'fixed' &&
        (manualHours === '8' || manualHours === '0')
      ) {
        setManualHours(
          String(
            hoursBetween(
              job.shift.startTime,
              job.shift.endTime,
              job.shift.breakMinutes,
            ),
          ),
        );
      }
      if (
        job.rule.payType !== 'piece' &&
        !(job.rule.payType === 'monthly' && job.rule.monthlyMode === 'fixed') &&
        manualHours === '0'
      ) {
        setManualHours('8');
      }
    }
  };

  const switchTimeMode = (next: TimeMode) => {
    dirtyRef.current = true;
    if (next === 'manual' && timeMode === 'range' && netHours > 0) {
      setManualHours(String(netHours));
    }
    setTimeMode(next);
    setError('');
  };

  const requestClose = () => {
    if (dirtyRef.current) {
      afterDiscardRef.current = null;
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  // 「管理」会直接关掉编辑器，未保存内容同样要先确认放弃。
  const requestManageJobs = () => {
    if (dirtyRef.current) {
      afterDiscardRef.current = onManageJobs;
      setDiscardOpen(true);
      return;
    }
    onManageJobs();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    if (!selectedJob || !rule) {
      showError('请先选择一份工作');
      return;
    }
    if (existing?.settlementId) {
      showError('这笔工记已经结算，请先撤销结算再修改');
      return;
    }
    if (!(rule.rate > 0)) {
      showError('这份工作的单价还是 0，请先去工作管理里设置');
      return;
    }
    const otherDayHours = state.entries
      .filter((entry) => entry.date === date && entry.id !== existing?.id)
      .reduce((sum, entry) => sum + (entry.hours || 0), 0);
    if (hours > 0 && otherDayHours + hours > 24) {
      showError(
        `当天已记 ${formatHours(otherDayHours)}h，再加 ${formatHours(hours)}h 会超过 24 小时，请核对`,
      );
      return;
    }
    if (isHourly) {
      if (timeMode === 'range') {
        if (startTime === endTime) {
          showError('上下班时间不能一样');
          return;
        }
        if (netHours <= 0) {
          showError('休息时长不能超过在岗时长');
          return;
        }
        if (netHours > 24) {
          showError('单笔工时超过 24 小时，确认一下时间');
          return;
        }
      } else if (manualHoursValue <= 0) {
        showError('工时需要大于 0');
        return;
      } else if (manualHoursValue > 24) {
        showError('单笔工时超过 24 小时，确认一下');
        return;
      }
    } else if (manualHoursValue > 24) {
      showError('工时超过 24 小时，确认一下');
      return;
    }
    if (isPiece && !(quantityValue > 0)) {
      showError('计件数量需要大于 0');
      return;
    }
    if (isPiece && quantityValue > 1_000_000) {
      showError('计件数量看起来不太对，确认一下');
      return;
    }
    if (enteredOt > 24) {
      showError('加班时长超过 24 小时，确认一下');
      return;
    }

    const restMoved = Boolean(findRestOnDay(state.restDays, selectedJob.id, date));
    const nextPhotoId = photoTouched
      ? photoDraft
        ? existing?.photoId ?? createPhotoId()
        : undefined
      : existing?.photoId;
    const base = {
      jobId: selectedJob.id,
      date,
      hours: round2(hours),
      quantity: isPiece ? round2(quantityValue) : 0,
      otHours: round2(effectiveOt),
      bonus: round2(Math.max(0, toAmount(bonus))),
      deduction: round2(Math.max(0, toAmount(deduction))),
      holiday: Boolean(overtimeEnabled && holiday),
      note: note.trim() || undefined,
      photoId: nextPhotoId,
      rule,
      breakMinutes:
        isHourly && timeMode === 'range'
          ? Math.max(0, Math.round(breakMinutes))
          : isPiece
            ? 0
            : existing && existing.jobId === selectedJob.id
              ? existing.breakMinutes
              : 0,
      startTime:
        isHourly && timeMode === 'range'
          ? startTime
          : isPiece
            ? undefined
            : existing && existing.jobId === selectedJob.id
              ? existing.startTime
              : undefined,
      endTime:
        isHourly && timeMode === 'range'
          ? endTime
          : isPiece
            ? undefined
            : existing && existing.jobId === selectedJob.id
              ? existing.endTime
              : undefined,
    };

    submittingRef.current = true;
    let savedNewEntry: Entry | null = null;
    try {
      if (existing) {
        const ok = updateEntry(existing.id, base);
        if (!ok) {
          showError('修改失败：目标日期合计超过 24 小时，或周期已经结算，请先撤销');
          return;
        }
        toast(restMoved ? '工记已更新，这天的休息已移到回收站' : '工记已更新');
      } else {
        const created = addEntry(base);
        savedNewEntry = created;
        if (!created) {
          showError('没有保存：这个周期已经结算过了，或当天合计超过 24 小时');
          return;
        }
        toast(restMoved ? '已记上一笔，这天的休息已移到回收站' : '已记上一笔');
      }

      if (photoTouched) {
        if (photoDraft && nextPhotoId) {
          try {
            await putPhoto(nextPhotoId, photoDraft);
          } catch {
            // 照片没写进去就撤掉引用，避免详情页把它误报成“照片损坏”；
            // 编辑旧记录时保留原来那张照片，不能被这次失败连坐。
            const hadPhoto = Boolean(existing?.photoId);
            const targetId = savedNewEntry?.id ?? existing?.id;
            if (targetId && !hadPhoto) updateEntry(targetId, { photoId: undefined });
            toast(
              hadPhoto
                ? '新照片保存失败，已保留原照片'
                : '照片保存失败，工记已保存且未保留照片引用',
              'error',
            );
          }
        } else if (existing?.photoId) {
          void deletePhoto(existing.photoId).catch(() => undefined);
        }
      }

      dirtyRef.current = false;
      onClose();
    } finally {
      submittingRef.current = false;
    }
  };

  if (entryId && !existing) {
    return (
      <Sheet open title="工记详情" onClose={onClose}>
        <div className="editor-empty">
          <EmptyState
            icon={Briefcase}
            title="这笔记录不见了"
            description="它可能已经被删除。"
            actionLabel="关闭"
            onAction={onClose}
          />
        </div>
      </Sheet>
    );
  }

  if (selectableJobs.length === 0) {
    return (
      <Sheet open title="记一笔" onClose={onClose}>
        <div className="editor-empty">
          <EmptyState
            icon={Briefcase}
            title="还没有可以记工的工作"
            description="先建一份工作，设置好单价和结算周期。"
            actionLabel="去新建工作"
            onAction={onManageJobs}
          />
        </div>
      </Sheet>
    );
  }

  if (existing?.settlementId) {
    return (
      <Sheet open title="编辑工记" onClose={onClose}>
        <div className="editor-empty">
          <EmptyState
            icon={LockKeyhole}
            title="这笔工记已结算"
            description="已结算的记录不能修改。请先在结算页撤销对应结算单。"
            actionLabel="知道了"
            onAction={onClose}
          />
        </div>
      </Sheet>
    );
  }

  return (
    <>
      <Sheet open ariaLabel={existing ? '编辑工记' : '记一笔'} onClose={requestClose} className="entry-sheet">
        <form
          className="entry-form"
          onSubmit={handleSubmit}
          onChange={() => {
            dirtyRef.current = true;
            setError('');
          }}
        >
        <header className="entry-head">
          <div>
            <p className="eyebrow">{existing ? '修改记录' : '新的工记'}</p>
            <h2>{existing ? '编辑工记' : '记一笔'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={requestClose} aria-label="关闭">
            <X size={20} />
          </button>
        </header>

        <div className="entry-scroll">
          <div className="field">
            <div className="field-head">
              <span className="field-label">工作</span>
              <button type="button" className="text-link" onClick={requestManageJobs}>
                管理
              </button>
            </div>
            <div className="job-picker" ref={jobPickerRef}>
              {selectableJobs.map((job) => (
                <button
                  type="button"
                  key={job.id}
                  className={`job-choice ${job.id === jobId ? 'is-active' : ''}`}
                  onClick={() => chooseJob(job)}
                >
                  <JobDot color={job.color} size={8} />
                  <span>{job.name}</span>
                  {job.archived ? <em>已归档</em> : null}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">记在哪天</span>
            <div className="quick-date-row">
              {quickDates.map((item) => (
                <button
                  type="button"
                  key={item.offset}
                  className={`date-chip ${date === item.iso ? 'is-active' : ''}`}
                  onClick={() => {
                    dirtyRef.current = true;
                    setDate(item.iso);
                  }}
                >
                  <strong>{item.label}</strong>
                  <span>{formatDateCompact(item.iso)}</span>
                </button>
              ))}
              <label className={`date-native ${isQuickDate ? '' : 'is-active'}`} title="选择日期">
                <CalendarDays size={15} />
                <span>{isQuickDate ? '换日期' : formatDateCompact(date)}</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => {
                    if (event.target.value) {
                      setDate(event.target.value);
                      setError('');
                    }
                  }}
                  aria-label="选择日期"
                />
              </label>
            </div>
            <p className="field-hint">记在 {formatDateFull(date)}</p>
          </div>

          {isHourly ? (
            <>
              <div className="mode-tabs" role="group" aria-label="工时填写方式">
                <button
                  type="button"
                  className={timeMode === 'range' ? 'is-active' : ''}
                  onClick={() => switchTimeMode('range')}
                >
                  按上下班时间
                </button>
                <button
                  type="button"
                  className={timeMode === 'manual' ? 'is-active' : ''}
                  onClick={() => switchTimeMode('manual')}
                >
                  直接填工时
                </button>
              </div>

              {timeMode === 'range' ? (
                <>
                  <div className="duration-presets" role="group" aria-label="常用时长">
                    <span>常用时长</span>
                    {DURATION_PRESETS.map((preset) => (
                      <button
                        type="button"
                        key={preset}
                        className={
                          Math.abs(netHours - preset) < 0.01 ? 'is-active' : ''
                        }
                        onClick={() => {
                          dirtyRef.current = true;
                          setEndTime(endTimeForDuration(startTime, preset, breakMinutes));
                        }}
                      >
                        {preset}h
                      </button>
                    ))}
                  </div>
                  <div className="time-grid">
                    <label className="time-box">
                      <span>上班</span>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(event) => setStartTime(event.target.value)}
                      />
                    </label>
                    <span className="time-sep">→</span>
                    <label className="time-box">
                      <span>下班</span>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(event) => setEndTime(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="break-row">
                    <span className="break-label">休息</span>
                    <div className="mini-chips">
                      {[0, 30, 60, 90].map((value) => (
                        <button
                          type="button"
                          key={value}
                          className={breakMinutes === value ? 'is-active' : ''}
                          onClick={() => {
                            dirtyRef.current = true;
                            setBreakMinutes(value);
                          }}
                        >
                          {value === 0 ? '无' : `${value}分`}
                        </button>
                      ))}
                    </div>
                    <label className="break-custom">
                      <input
                        type="number"
                        min={0}
                        max={720}
                        step={5}
                        value={breakMinutes}
                        onChange={(event) =>
                          setBreakMinutes(Math.max(0, Math.min(720, Number(event.target.value) || 0)))
                        }
                        aria-label="休息分钟数"
                      />
                      <span>分钟</span>
                    </label>
                  </div>
                  <div className={`duration-strip ${netHours <= 0 ? 'is-invalid' : ''}`}>
                    <span>
                      <Clock3 size={15} />
                      {endTime < startTime ? '跨天 · ' : ''}在岗 {formatHours(workedHours)}h
                    </span>
                    <em>− 休息 {breakMinutes} 分钟</em>
                    <strong>
                      {formatHours(netHours)}
                      <small>h</small>
                    </strong>
                  </div>
                </>
              ) : (
                <div className="manual-hours">
                  <label>
                    <span>总工时</span>
                    <div className="big-number-input">
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={0.5}
                        value={manualHours}
                        onChange={(event) => setManualHours(event.target.value)}
                        inputMode="decimal"
                      />
                      <em>小时</em>
                    </div>
                  </label>
                  <p className="field-hint">包括加班在内的总时长。</p>
                </div>
              )}
            </>
          ) : isPiece ? (
            <>
              <div className="piece-card">
                <div className="piece-card-head">
                  <span>计件数量</span>
                  <em>
                    {rule?.unitLabel || '件'} · 单价 <Money value={rule?.rate ?? 0} />
                  </em>
                </div>
                <div className="piece-number">
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={quantity}
                    onChange={(event) => {
                      setQuantity(event.target.value);
                      if (error) setError('');
                    }}
                    inputMode="decimal"
                    placeholder="0"
                    aria-label="计件数量"
                  />
                  <span>{rule?.unitLabel || '件'}</span>
                </div>
                <p className="field-hint">
                  数量 × 单价，自动算本笔计件工资
                  {previewPay && previewPay.base > 0 ? (
                    <>
                      {' '}
                      · <Money value={previewPay.base} />
                    </>
                  ) : null}
                </p>
              </div>
              <label className="field">
                <span className="field-label">工时（选填）</span>
                <div className="inline-number">
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={manualHours}
                    onChange={(event) => setManualHours(event.target.value)}
                    inputMode="decimal"
                  />
                  <span>小时</span>
                </div>
                <p className="field-hint">只影响统计，不参与计件工资计算。</p>
              </label>
            </>
          ) : (
            <>
              <div className="attendance-card">
                <span className="attendance-icon">
                  <CheckCircle2 size={20} />
                </span>
                <div>
                  <strong>出勤 1 天</strong>
                  <p>
                    {isFixedMonthly ? (
                      <>
                        固定月薪 <Money value={rule?.rate ?? 0} /> · 整月计
                      </>
                    ) : isMonthly ? (
                      <>
                        月薪 <Money value={rule?.rate ?? 0} /> ÷ {rule?.expectedDays ?? 22} 天折算
                      </>
                    ) : (
                      <>
                        日薪 <Money value={rule?.rate ?? 0} />
                      </>
                    )}
                  </p>
                  {isFixedMonthly ? (
                    <p className="attendance-shift">
                      默认 {startTime}–{endTime} · 午休 {breakMinutes} 分 · 在岗{' '}
                      {formatHours(netHours)}h
                    </p>
                  ) : null}
                </div>
              </div>
              <label className="field">
                <span className="field-label">工时（选填）</span>
                <div className="inline-number">
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={manualHours}
                    onChange={(event) => setManualHours(event.target.value)}
                    inputMode="decimal"
                  />
                  <span>小时</span>
                </div>
                <p className="field-hint">
                  {isFixedMonthly
                    ? '默认按班次带入，只影响统计，不影响固定月薪。'
                    : '只影响统计，不影响日薪 / 月薪。'}
                </p>
              </label>
            </>
          )}

          {overtimeEnabled && rule ? (
            <div className="ot-card">
              <div className="ot-head">
                <span>加班费</span>
                <em className="rate-pill">{multiplierText}×</em>
              </div>
              {isHourly ? (
                <div className="ot-auto">
                  <strong>
                    {autoOt > 0 ? `${formatHours(autoOt)} 小时` : '无加班'}
                  </strong>
                  <p>
                    超过标准 {rule.standardHours}h 自动计算
                    {previewPay && previewPay.otPay > 0 ? (
                      <>
                        {' '}
                        · 约 <Money value={previewPay.otPay} />
                      </>
                    ) : null}
                  </p>
                </div>
              ) : (
                <div className="ot-manual">
                  <label>
                    <span>加班时长</span>
                    <div className="inline-number">
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={0.5}
                        value={otHoursInput}
                        onChange={(event) => setOtHoursInput(event.target.value)}
                        inputMode="decimal"
                      />
                      <span>小时</span>
                    </div>
                  </label>
                  <p className="field-hint">
                    加班时薪约 <Money value={otHourlyRate(rule)} />，按倍率计算。
                  </p>
                </div>
              )}
              <button
                type="button"
                className={`switch-row ${holiday ? 'is-on' : ''}`}
                role="switch"
                aria-checked={holiday}
                onClick={() => {
                  dirtyRef.current = true;
                  setHoliday((value) => !value);
                }}
              >
                <span>
                  <Sun size={15} />
                  按法定节假日计算
                </span>
                <span className="switch-track">
                  <i />
                </span>
              </button>
              <p className="field-hint">
                {holiday
                  ? `已按节假日 ${rule.holidayOT}× 计算`
                  : isWeekend(date)
                    ? `这天是周末，加班按 ${rule.weekendOT}× 计算`
                    : `平日加班按 ${rule.weekdayOT}× 计算`}
              </p>
            </div>
          ) : isPiece ? (
            <p className="inline-hint">
              <Banknote size={14} />
              计件工资按数量 × 单价计算，工时只用于统计。
            </p>
          ) : (
            <p className="inline-hint">
              <Clock3 size={14} />
              这份工作未开启加班费，工时按基础单价计算。
            </p>
          )}

          <button
            type="button"
            className="more-toggle"
            onClick={() => setMoreOpen((value) => !value)}
            aria-expanded={moreOpen}
          >
            <span>
              <Banknote size={16} />
              奖金 / 扣款 / 备注
              {Number(bonus) > 0 || Number(deduction) > 0 ? (
                <em className="mini-badge">已填</em>
              ) : null}
            </span>
            <ChevronDown size={17} className={moreOpen ? 'is-open' : ''} />
          </button>
          {moreOpen ? (
            <div className="more-panel">
              <div className="two-col">
                <label className="field">
                  <span className="field-label">奖金 / 补贴</span>
                  <div className="money-mini">
                    <span>¥</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={bonus}
                      onChange={(event) => setBonus(event.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </div>
                </label>
                <label className="field">
                  <span className="field-label">扣款</span>
                  <div className="money-mini">
                    <span>¥</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={deduction}
                      onChange={(event) => setDeduction(event.target.value)}
                      placeholder="0"
                      inputMode="decimal"
                    />
                  </div>
                </label>
              </div>
              <label className="field">
                <span className="field-label">备注</span>
                <textarea
                  className="text-area"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="例如：夜班、餐补、扣住宿费…"
                  maxLength={80}
                  rows={2}
                />
              </label>
            </div>
          ) : null}

          <div className="photo-field">
            <div className="field-head">
              <span className="field-label">考勤照片（选填）</span>
              <em className="photo-badge">只存本机</em>
            </div>
            <input
              ref={photoInputRef}
              className="photo-input"
              type="file"
              accept="image/*"
              aria-label="选择考勤照片"
              onChange={(event) => void handlePhotoFile(event)}
            />
            {photoDraft ? (
              <div className="photo-preview">
                <img src={photoDraft} alt="考勤照片预览" />
                <div className="photo-actions">
                  <button
                    type="button"
                    className="btn btn--soft"
                    onClick={pickPhoto}
                    disabled={photoBusy}
                  >
                    <Camera size={15} />
                    更换
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={removePhoto}
                    disabled={photoBusy}
                  >
                    <X size={15} />
                    移除
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="photo-add"
                onClick={pickPhoto}
                disabled={photoBusy}
              >
                {photoBusy ? <span className="payslip-spinner" /> : <Camera size={19} />}
                <span>{photoBusy ? '正在处理照片…' : '拍照或从相册选择'}</span>
              </button>
            )}
            {photoError ? <p className="form-error" role="alert">{photoError}</p> : null}
            <p className="field-hint">
              自动加岗位 / 日期 / 工时水印；照片不上传，也不随备份迁移。
            </p>
          </div>
        </div>

        <div className="entry-footer">
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="entry-footer-main">
            <div className="entry-preview">
              <span>
                {isPiece
                  ? '本笔计件'
                  : isFixedMonthly
                    ? '当日折算参考'
                    : isMonthly
                      ? '本笔折算'
                      : '本笔预计'}
              </span>
              <Money value={previewPay?.total ?? 0} className="entry-preview-money" />
              <p>
                {previewPay && previewPay.otHours > 0 ? (
                  <>
                    含加班 {formatHours(previewPay.otHours)}h ·{' '}
                  </>
                ) : null}
                {isPiece
                  ? `${formatHours(quantityValue)} ${rule?.unitLabel || '件'} × 单价`
                  : isFixedMonthly
                    ? '固定月薪，此处金额仅作参考'
                    : isMonthly
                      ? '整月结算时封顶'
                      : existing && existing.jobId === jobId
                        ? '按记录时的单价'
                        : '按当前单价计算'}
              </p>
            </div>
            <button
              type="submit"
              className="btn btn--primary entry-save"
              disabled={!selectedJob || !rule || photoBusy}
            >
              {existing ? '保存' : '记上'}
            </button>
          </div>
        </div>
      </form>
      </Sheet>

      <ConfirmDialog
        open={discardOpen}
        title="放弃这次编辑？"
        description="已经填写的内容不会保存。"
        confirmLabel="放弃"
        danger
        onCancel={() => {
          afterDiscardRef.current = null;
          setDiscardOpen(false);
        }}
        onConfirm={() => {
          setDiscardOpen(false);
          const action = afterDiscardRef.current;
          afterDiscardRef.current = null;
          (action ?? onClose)();
        }}
      />
    </>
  );
}
