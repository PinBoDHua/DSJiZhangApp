import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v080-perf';
await mkdir(OUT, { recursive: true });

const today = '2026-11-06';
const pad = (value) => String(value).padStart(2, '0');
const addDays = (iso, days) => {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

function makeState(entryCount) {
  const job = {
    id: 'job-1',
    name: '长期工',
    employer: '测试工厂',
    color: 'pine',
    rule: {
      payType: 'hourly',
      rate: 25,
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
    },
    shift: { startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
    cycle: 'weekly',
    archived: false,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
  const entries = Array.from({ length: entryCount }, (_, index) => {
    const date = addDays(today, -index);
    return {
      id: `entry-${index}`,
      jobId: 'job-1',
      date,
      startTime: '08:00',
      endTime: '17:00',
      breakMinutes: 60,
      hours: 8,
      quantity: 0,
      otHours: 0,
      bonus: 0,
      deduction: 0,
      holiday: false,
      note: index % 7 === 0 ? `第 ${index} 天加班` : '',
      rule: job.rule,
      createdAt: `${date}T12:00:00.000Z`,
      updatedAt: `${date}T12:00:00.000Z`,
    };
  });
  return {
    version: 7,
    profile: { name: '压力测试', hideAmounts: false },
    settings: {
      weekStartsOn: 1,
      theme: 'light',
      reminder: { enabled: false, time: '21:00' },
    },
    jobs: [job],
    trashedJobs: [],
    entries,
    restDays: [],
    advances: [],
    settlements: [],
    activeTimer: null,
    onboardingDone: true,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function run(label, entryCount) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    serviceWorkers: 'block',
  });
  const state = makeState(entryCount);
  await context.addInitScript(
    ({ stateJson, consent }) => {
      localStorage.setItem('xinshi.privacyConsent', consent);
      localStorage.setItem('xinshi.theme', 'light');
      localStorage.setItem('xinshi.state.v7', stateJson);
    },
    { stateJson: JSON.stringify(state), consent: '2026-11-05' },
  );
  const page = await context.newPage();
  const start = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loadMs = Date.now() - start;
  await page.locator('.home-page').waitFor();
  const homeMs = Date.now() - start;
  // 等空闲预取完成后再测切换，模拟真实用户停留几秒后点底部 Tab
  await page.waitForTimeout(3200);
  const timings = {};
  for (const tab of ['记录', '结算', '统计', '我的']) {
    const t = Date.now();
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.locator('.page').waitFor();
    await page.waitForTimeout(120);
    timings[tab] = Date.now() - t;
  }
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(300);
  const yearStart = Date.now();
  await page.getByRole('button', { name: '本年', exact: true }).click();
  await page.waitForTimeout(300);
  timings['本年'] = Date.now() - yearStart;
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  console.log(
    `${label}: load=${loadMs}ms home=${homeMs}ms tabs=${JSON.stringify(timings)} heap=${Math.round(heap / 1048576)}MB`,
  );
  await page.screenshot({ path: `${OUT}/${label}.png` });
  await context.close();
}

await run('demo-40', 40);
await run('large-2000', 2000);
await browser.close();
