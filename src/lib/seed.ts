import type { AppState, Entry, Job, PayRule } from '../types';
import { addDays, hoursBetween, nowISO, todayISO } from './date';
import { createId } from './id';
import { autoOtHours } from './pay';

function rule(overrides: Partial<PayRule> & Pick<PayRule, 'payType' | 'rate'>): PayRule {
  return {
    standardHours: 8,
    expectedDays: 22,
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
  const renovationRule = rule({ payType: 'monthly', rate: 7500 });

  const site: Job = {
    id: createId('job'),
    name: '城南工地',
    employer: '城南 · 三号院',
    color: 'amber',
    rule: siteRule,
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
    cycle: 'monthly',
    archived: false,
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
    cycle: 'weekly',
    archived: false,
    createdAt,
  };

  const entries: Entry[] = [
    makeEntry({
      job: site,
      offset: 3,
      start: '08:00',
      end: '18:00',
      breakMinutes: 60,
      otHours: 2,
      note: '周日赶工',
    }),
    makeEntry({
      job: site,
      offset: 2,
      start: '08:00',
      end: '17:00',
      breakMinutes: 60,
      bonus: 30,
      note: '现场补贴',
    }),
    makeEntry({
      job: site,
      offset: 1,
      start: '08:00',
      end: '18:00',
      breakMinutes: 60,
      otHours: 1,
    }),
    makeEntry({
      job: site,
      offset: 5,
      start: '08:00',
      end: '17:00',
      breakMinutes: 60,
    }),
    makeEntry({
      job: sorting,
      offset: 0,
      start: '19:30',
      end: '04:30',
      breakMinutes: 30,
      note: '夜班',
    }),
    makeEntry({
      job: sorting,
      offset: 1,
      start: '19:30',
      end: '04:30',
      breakMinutes: 30,
      note: '夜班',
    }),
    makeEntry({
      job: sorting,
      offset: 2,
      start: '19:30',
      end: '04:30',
      breakMinutes: 30,
      bonus: 20,
      note: '夜班 · 全勤奖',
    }),
    makeEntry({
      job: sorting,
      offset: 3,
      start: '19:30',
      end: '04:30',
      breakMinutes: 30,
      note: '周日夜班',
    }),
    makeEntry({
      job: sorting,
      offset: 5,
      start: '19:30',
      end: '04:30',
      breakMinutes: 30,
      note: '夜班',
    }),
    makeEntry({
      job: renovation,
      offset: 0,
      start: '09:00',
      end: '18:00',
      breakMinutes: 60,
      otHours: 0.5,
      note: '收尾',
    }),
    makeEntry({
      job: renovation,
      offset: 1,
      start: '09:00',
      end: '19:00',
      breakMinutes: 60,
      otHours: 1,
      note: '水电验收',
    }),
    makeEntry({
      job: renovation,
      offset: 2,
      start: '09:00',
      end: '18:00',
      breakMinutes: 60,
    }),
    makeEntry({
      job: renovation,
      offset: 3,
      start: '09:00',
      end: '18:30',
      breakMinutes: 60,
      otHours: 0.5,
    }),
    makeEntry({
      job: packing,
      offset: 0,
      start: '14:00',
      end: '18:00',
      breakMinutes: 0,
      quantity: 150,
      note: '节日礼盒',
    }),
    makeEntry({
      job: packing,
      offset: 2,
      start: '13:30',
      end: '18:30',
      breakMinutes: 0,
      quantity: 200,
      note: '节日礼盒',
    }),
  ];

  const advanceDate = addDays(todayISO(), -2);
  return {
    version: 3,
    profile: { name: '李师傅', hideAmounts: false },
    settings: {
      weekStartsOn: 1,
      theme: 'system',
      reminder: { enabled: false, time: '21:00' },
    },
    jobs: [site, sorting, renovation, packing],
    entries,
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
