import type { AppState, Entry, Job, PayRule, RestDay } from '../types';
import { addDays, hoursBetween, nowISO, todayISO } from './date';
import { createId } from './id';
import { autoOtHours } from './pay';

function rule(overrides: Partial<PayRule> & Pick<PayRule, 'payType' | 'rate'>): PayRule {
  return {
    standardHours: 8,
    expectedDays: 22,
    monthlyMode: 'prorated',
    restDaysPerMonth: 0,
    restPolicy: 'quota',
    overRestDeduct: false,
    overRestDailyRate: 0,
    unitLabel: '件',
    otEnabled: true,
    weekdayOT: 1.5,
    weekendOT: 2,
    holidayOT: 3,
    ...overrides,
  };
}

interface EntryOptions {
  job: Job;
  offset: number;
  start: string;
  end: string;
  breakMinutes: number;
  quantity?: number;
  otHours?: number;
  bonus?: number;
  deduction?: number;
  note?: string;
  holiday?: boolean;
}

function makeEntry(options: EntryOptions): Entry {
  const { job, offset, start, end, breakMinutes } = options;
  const date = addDays(todayISO(), -offset);
  const hours = hoursBetween(start, end, breakMinutes);
  const otHours =
    job.rule.payType === 'hourly' ? autoOtHours(hours, job.rule) : Math.max(0, options.otHours ?? 0);
  const createdAt = `${date}T12:00:00.000Z`;
  return {
    id: createId('entry'),
    jobId: job.id,
    date,
    startTime: start,
    endTime: end,
    breakMinutes,
    hours,
    quantity: options.quantity ?? 0,
    otHours,
    bonus: options.bonus ?? 0,
    deduction: options.deduction ?? 0,
    holiday: options.holiday ?? false,
    note: options.note,
    rule: { ...job.rule },
    createdAt,
    updatedAt: createdAt,
  };
}

export function createDemoState(): AppState {
  const createdAt = nowISO();
  const siteRule = rule({ payType: 'daily', rate: 320 });
  const sortingRule = rule({ payType: 'hourly', rate: 22 });
  const renovationRule = rule({
    payType: 'monthly',
    rate: 3500,
    standardHours: 6,
    monthlyMode: 'fixed',
    restDaysPerMonth: 5,
    otEnabled: false,
  });

  const site: Job = {
    id: createId('job'),
    name: '城南工地',
    employer: '城南 · 三号院',
    color: 'amber',
    rule: siteRule,
    shift: { startTime: '08:00', endTime: '18:00', breakMinutes: 60 },
    cycle: 'weekly',
    archived: false,
    createdAt,
  };
  const sorting: Job = {
    id: createId('job'),
    name: '顺丰夜班分拣',
    employer: '城东分拨中心',
    color: 'pine',
    rule: sortingRule,
    shift: { startTime: '19:30', endTime: '04:30', breakMinutes: 30 },
    cycle: 'weekly',
    archived: false,
    createdAt,
  };
  const renovation: Job = {
    id: createId('job'),
    name: '老宅装修',
    employer: '青禾设计',
    color: 'clay',
    rule: renovationRule,
    shift: { startTime: '09:00', endTime: '17:00', breakMinutes: 120 },
    cycle: 'monthly',
    archived: false,
    // 示例数据的发薪日跟着「今天」走，打开示例时总能演示发薪提醒。
    payday: Number(addDays(todayISO(), 2).slice(8, 10)),
    createdAt,
  };
  const pieceRule = rule({
    payType: 'piece',
    rate: 1.2,
    unitLabel: '件',
    otEnabled: false,
  });
  const packing: Job = {
    id: createId('job'),
    name: '礼盒包装',
    employer: '城西电商仓',
    color: 'olive',
    rule: pieceRule,
    shift: { startTime: '14:00', endTime: '18:00', breakMinutes: 0 },
    cycle: 'weekly',
    archived: false,
    createdAt,
  };

  const entries: Entry[] = [
    makeEntry({
      job: site,
      offset: 35,
      start: '08:00',
      end: '17:00',
      breakMinutes: 60,
      note: '临时帮忙',
    }),
    makeEntry({
      job: site,
      offset: 34,
      start: '08:00',
      end: '16:00',
      breakMinutes: 60,
      bonus: 30,
      note: '现场补贴',
    }),
    makeEntry({
      job: sorting,
      offset: 36,
      start: '19:30',
      end: '04:30',
      breakMinutes: 30,
      note: '夜班',
    }),
    makeEntry({
      job: packing,
      offset: 37,
      start: '14:00',
      end: '18:00',
      breakMinutes: 0,
      quantity: 150,
      note: '节日礼盒',
    }),
    makeEntry({
      job: renovation,
      offset: 0,
      start: '09:00',
      end: '17:00',
      breakMinutes: 120,
      note: '收尾',
    }),
    makeEntry({
      job: renovation,
      offset: 1,
      start: '09:00',
      end: '17:00',
      breakMinutes: 120,
      note: '水电验收',
    }),
  ];

  const advanceDate = addDays(todayISO(), -2);
  const restDays: RestDay[] = [
    {
      id: createId('rest'),
      jobId: renovation.id,
      date: addDays(todayISO(), -2),
      note: '月休',
      createdAt: `${addDays(todayISO(), -2)}T12:00:00.000Z`,
    },
    {
      id: createId('rest'),
      jobId: renovation.id,
      date: addDays(todayISO(), -3),
      note: '月休',
      createdAt: `${addDays(todayISO(), -3)}T12:00:00.000Z`,
    },
  ];
  return {
    version: 7,
    profile: { name: '李师傅', hideAmounts: false },
    settings: {
      weekStartsOn: 1,
      theme: 'system',
      reminder: { enabled: false, time: '21:00' },
    },
    jobs: [site, sorting, renovation, packing],
    trashedJobs: [],
    entries,
    restDays,
    advances: [
      {
        id: createId('advance'),
        jobId: site.id,
        date: advanceDate,
        amount: 500,
        note: '预支生活费',
        createdAt: `${advanceDate}T09:00:00.000Z`,
      },
    ],
    settlements: [],
    activeTimer: null,
    onboardingDone: true,
    createdAt,
  };
}
