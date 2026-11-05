import type { AppState } from '../types';
import { round2 } from './money';
import { todayISO } from './date';

export type HealthSeverity = 'critical' | 'warning' | 'info';

export interface HealthIssue {
  code: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  count: number;
  refs: string[];
  fixable?: boolean;
}

export interface HealthReport {
  issues: HealthIssue[];
  counts: Record<HealthSeverity, number>;
  checkedAt: string;
  entryCount: number;
}

export interface HealthOptions {
  today?: string;
  lastBackupAt?: string | null;
}

function expectedSettlementNet(
  settlement: AppState['settlements'][number],
): number {
  return round2(
    settlement.base +
      settlement.otPay +
      settlement.bonus -
      settlement.deduction -
      (settlement.overRestDeduction ?? 0) -
      settlement.advanceTotal +
      settlement.extraBonus -
      settlement.extraDeduction,
  );
}

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function add(
  issues: HealthIssue[],
  item: Omit<HealthIssue, 'count' | 'refs'> & { refs: string[]; count?: number },
): void {
  if (item.refs.length === 0 && !item.count) return;
  issues.push({
    ...item,
    count: item.count ?? item.refs.length,
    refs: item.refs.slice(0, 60),
  });
}

export function checkLedger(state: AppState, options: HealthOptions = {}): HealthReport {
  const today = options.today ?? todayISO();
  const issues: HealthIssue[] = [];
  const jobIds = new Set([...state.jobs, ...state.trashedJobs.map((item) => item.job)].map((job) => job.id));
  const settlementMap = new Map(state.settlements.map((item) => [item.id, item]));
  const entryMap = new Map(state.entries.map((item) => [item.id, item]));
  const settlementByEntry = new Map<string, string[]>();

  for (const settlement of state.settlements) {
    for (const entryId of settlement.entryIds) {
      const list = settlementByEntry.get(entryId);
      if (list) list.push(settlement.id);
      else settlementByEntry.set(entryId, [settlement.id]);
    }
  }

  // 1. 结算金额与分项加总不一致
  const badSums = state.settlements.filter(
    (item) => Math.abs(item.net - expectedSettlementNet(item)) > 0.011,
  );
  add(issues, {
    code: 'settlement-sum-mismatch',
    severity: 'critical',
    title: '结算金额与分项对不上',
    detail: `${badSums.length} 张结算单的应发净额不等于分项加总，可能被手工改过或数据损坏。`,
    refs: badSums.map((item) => item.id),
  });

  // 2. 结算纳入了周期外的工记
  const outside = state.settlements.filter((settlement) =>
    settlement.entryIds.some((id) => {
      const entry = entryMap.get(id);
      return entry ? entry.date < settlement.periodStart || entry.date > settlement.periodEnd : false;
    }),
  );
  add(issues, {
    code: 'settlement-entry-outside-period',
    severity: 'critical',
    title: '结算单里混入了周期外的工记',
    detail: `${outside.length} 张结算单纳入了周期之外的工记，金额可能重复或算错。`,
    refs: outside.map((item) => item.id),
  });

  // 3. 工记 / 借支锁定在已不存在的结算上（唯一可安全自动修复项）
  const orphanLockedEntries = state.entries.filter(
    (entry) => entry.settlementId && !settlementMap.has(entry.settlementId),
  );
  const orphanLockedAdvances = state.advances.filter(
    (advance) => advance.settlementId && !settlementMap.has(advance.settlementId),
  );
  add(issues, {
    code: 'orphan-settlement-lock',
    severity: 'critical',
    title: '工记 / 借支被不存在的结算单锁住',
    detail: `${orphanLockedEntries.length} 笔工记、${orphanLockedAdvances.length} 笔借支指向已删除的结算，无法重新结算。`,
    refs: [
      ...orphanLockedEntries.map((item) => item.id),
      ...orphanLockedAdvances.map((item) => item.id),
    ],
    fixable: true,
  });

  // 4. 同一笔工记被多张结算单纳入
  const multiSettled = [...settlementByEntry.entries()].filter(([, ids]) => ids.length > 1);
  add(issues, {
    code: 'entry-multi-settled',
    severity: 'critical',
    title: '同一笔工记出现在多张结算单里',
    detail: `${multiSettled.length} 笔工记被重复结算，可能重复发薪。`,
    refs: multiSettled.map(([entryId]) => entryId),
  });

  // 5. 结算周期颠倒 / 应发异常
  const invalidSettlements = state.settlements.filter(
    (item) =>
      item.periodStart > item.periodEnd ||
      !Number.isFinite(item.net) ||
      item.net < 0 ||
      !Number.isFinite(item.base) ||
      !Number.isFinite(item.advanceTotal),
  );
  add(issues, {
    code: 'settlement-invalid',
    severity: 'critical',
    title: '结算单的周期或金额异常',
    detail: `${invalidSettlements.length} 张结算单的周期起点晚于终点，或金额不是有效数字。`,
    refs: invalidSettlements.map((item) => item.id),
  });

  // 6. 记录引用了不存在的工作
  const orphanJobs = [
    ...state.entries.filter((item) => !jobIds.has(item.jobId)).map((item) => item.id),
    ...state.advances.filter((item) => !jobIds.has(item.jobId)).map((item) => item.id),
    ...state.restDays.filter((item) => !jobIds.has(item.jobId)).map((item) => item.id),
    ...state.settlements.filter((item) => !jobIds.has(item.jobId)).map((item) => item.id),
  ];
  add(issues, {
    code: 'orphan-job',
    severity: 'warning',
    title: '记录引用了不存在的工作',
    detail: `有 ${orphanJobs.length} 条记录找不到所属工作，统计和筛选可能不完整。`,
    refs: orphanJobs,
  });

  // 7. 结算里保存的工记 ID 找不到了
  const missingEntries = state.settlements.flatMap((settlement) =>
    settlement.entryIds.filter((id) => !entryMap.has(id)),
  );
  add(issues, {
    code: 'settlement-entry-missing',
    severity: 'warning',
    title: '结算单引用的工记已不存在',
    detail: `有 ${missingEntries.length} 个工记 ID 在账本里找不到，旧结算的明细会缺行。`,
    refs: missingEntries,
  });

  // 8. 同工作同日既有工记又有休息
  const restConflicts = state.restDays.filter((rest) =>
    state.entries.some((entry) => entry.jobId === rest.jobId && entry.date === rest.date),
  );
  add(issues, {
    code: 'rest-entry-conflict',
    severity: 'warning',
    title: '同一天既记了工又标了休息',
    detail: `${restConflicts.length} 个休息日和工记撞在同一天，休息天数可能被多算。`,
    refs: restConflicts.map((item) => item.id),
  });

  // 9. 同工作同日多条工记
  const entryKeys = new Map<string, number>();
  for (const entry of state.entries) {
    const key = `${entry.jobId}|${entry.date}`;
    entryKeys.set(key, (entryKeys.get(key) ?? 0) + 1);
  }
  const duplicateEntries = [...entryKeys.entries()].filter(([, count]) => count > 1);
  add(issues, {
    code: 'duplicate-entry',
    severity: 'warning',
    title: '同一工作同一天有多笔工记',
    detail: `${duplicateEntries.length} 组同日工记，可能是重复录入，也可能是一天两段班。`,
    refs: duplicateEntries.map(([key]) => key),
  });

  // 10. 一天所有工作合计超过 24 小时
  const dayHours = new Map<string, number>();
  for (const entry of state.entries) {
    dayHours.set(entry.date, (dayHours.get(entry.date) ?? 0) + (entry.hours || 0));
  }
  const overDays = [...dayHours.entries()].filter(([, hours]) => hours > 24.0001);
  add(issues, {
    code: 'day-hours-over-24',
    severity: 'warning',
    title: '同一天总工时超过 24 小时',
    detail: `${overDays.length} 天合计超过 24 小时，请核对日期或工时。`,
    refs: overDays.map(([date]) => date),
  });

  // 11. 休息天数不是 0.5 或 1
  const invalidRest = state.restDays.filter(
    (rest) => rest.days !== undefined && rest.days !== 1 && rest.days !== 0.5,
  );
  add(issues, {
    code: 'rest-days-invalid',
    severity: 'warning',
    title: '休息天数不是半天或整天',
    detail: `${invalidRest.length} 条休息记录的天数异常，月休额度可能算错。`,
    refs: invalidRest.map((item) => item.id),
  });

  // 12. 已收金额超过应发
  const overpaid = state.settlements.filter(
    (item) => (item.paidAmount ?? 0) > item.net + 0.011,
  );
  add(issues, {
    code: 'payment-over-net',
    severity: 'warning',
    title: '已收金额超过应发',
    detail: `${overpaid.length} 张结算单的已收大于应发，收款状态可能不对。`,
    refs: overpaid.map((item) => item.id),
  });

  // 13. 超休扣款超过固定月薪
  const jobMap = new Map(state.jobs.map((job) => [job.id, job]));
  const overRest = state.settlements.filter((settlement) => {
    if (!settlement.overRestDeduction) return false;
    const job = jobMap.get(settlement.jobId);
    if (!job || job.rule.monthlyMode !== 'fixed' || job.rule.payType !== 'monthly') return false;
    const salary = Math.max(job.rule.rate, settlement.base);
    return settlement.overRestDeduction > salary + 0.011;
  });
  add(issues, {
    code: 'overrest-over-salary',
    severity: 'warning',
    title: '超休扣款超过当月固定月薪',
    detail: `${overRest.length} 张结算单的超休扣款比月薪还高，请核对扣款天数或金额。`,
    refs: overRest.map((item) => item.id),
  });

  // 14. 提示项：未来工记 / 长期未结 / 空工作 / 备份过期
  const future = state.entries.filter((entry) => entry.date > today);
  add(issues, {
    code: 'future-entry',
    severity: 'info',
    title: '有未来日期的工记',
    detail: `${future.length} 笔工记日期在今天之后。批量补记计划日会产生这种记录，不一定是错误。`,
    refs: future.map((item) => item.id),
  });

  const stale = state.entries.filter(
    (entry) => !entry.settlementId && daysBetween(entry.date, today) > 60,
  );
  add(issues, {
    code: 'stale-unsettled',
    severity: 'info',
    title: '有超过 60 天没结算的工记',
    detail: `${stale.length} 笔工记录于 60 天前且还没进入结算。`,
    refs: stale.map((item) => item.id),
  });

  const emptyJobs = state.jobs.filter(
    (job) =>
      !state.entries.some((item) => item.jobId === job.id) &&
      !state.restDays.some((item) => item.jobId === job.id) &&
      !state.advances.some((item) => item.jobId === job.id) &&
      !state.settlements.some((item) => item.jobId === job.id),
  );
  add(issues, {
    code: 'empty-job',
    severity: 'info',
    title: '有空着的工作',
    detail: `${emptyJobs.length} 份工作还没有任何记录，可以归档或删除。`,
    refs: emptyJobs.map((item) => item.id),
  });

  if (state.entries.length > 0) {
    const lastBackup = options.lastBackupAt ? new Date(options.lastBackupAt) : null;
    const staleBackup =
      !lastBackup ||
      Number.isNaN(lastBackup.getTime()) ||
      Date.now() - lastBackup.getTime() > 14 * 86_400_000;
    if (staleBackup) {
      add(issues, {
        code: 'backup-stale',
        severity: 'info',
        title: '离机备份可能过期',
        detail: '超过 14 天没有导出备份。清缓存或换手机会丢账，建议现在备份一次。',
        refs: ['backup'],
      });
    }
  }

  const counts: Record<HealthSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;

  return { issues, counts, checkedAt: new Date().toISOString(), entryCount: state.entries.length };
}

export function applySafeFixes(
  state: AppState,
  codes: string[],
): { state: AppState; fixed: number } {
  if (!codes.includes('orphan-settlement-lock')) return { state, fixed: 0 };
  const settlementIds = new Set(state.settlements.map((item) => item.id));
  let fixed = 0;
  const entries = state.entries.map((entry) => {
    if (entry.settlementId && !settlementIds.has(entry.settlementId)) {
      fixed += 1;
      return { ...entry, settlementId: undefined };
    }
    return entry;
  });
  const advances = state.advances.map((advance) => {
    if (advance.settlementId && !settlementIds.has(advance.settlementId)) {
      fixed += 1;
      return { ...advance, settlementId: undefined };
    }
    return advance;
  });
  return { state: { ...state, entries, advances }, fixed };
}

export function healthBadgeText(report: HealthReport): string {
  if (report.counts.critical > 0) return `${report.counts.critical} 项严重`;
  if (report.counts.warning > 0) return `${report.counts.warning} 项提醒`;
  if (report.counts.info > 0) return `${report.counts.info} 项提示`;
  return '账本正常';
}
