import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v054';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
});
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('xinshi.privacyConsent', '2026-11-05'));
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

async function step(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: `${OUT}/failed-${name.replace(/\s+/g, '-')}.png` });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(500);
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
  state.jobs.find((job) => job.name === '老宅装修').workWeekdays = [1, 2, 3, 4, 5, 6];
  state.jobs.find((job) => job.name === '城南工地').workWeekdays = [0, 1, 2, 3, 4];
  localStorage.setItem('xinshi.state.v7', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await step('多个固定排班岗位可以切换', async () => {
  assert.equal(await page.locator('.plan-week-tabs button').count(), 2);
  assert.ok((await page.locator('.plan-week-head').innerText()).includes('城南工地'));
  await page.locator('.plan-week-tabs button').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(300);
  const head = await page.locator('.plan-week-head').innerText();
  assert.ok(head.includes('老宅装修'), head);
  assert.ok(head.includes('周一至周六'), head);
  await page.locator('.plan-week-tabs button').filter({ hasText: '城南工地' }).click();
  await page.waitForTimeout(250);
  assert.ok((await page.locator('.plan-week-head').innerText()).includes('城南工地'));
});

await step('点未来计划上班日会打开预填日期的工记', async () => {
  await page.locator('.plan-week-tabs button').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(250);
  const planDay = page.locator('.plan-week-day.is-work').first();
  assert.ok(await planDay.count(), '7 天内没有可补记的上班日');
  const planLabel = await planDay.getAttribute('aria-label');
  const planDate = planLabel.split(' ')[0];
  await planDay.click();
  await page.waitForTimeout(400);
  assert.equal(
    await page.getByLabel('选择日期', { exact: true }).inputValue(),
    planDate,
  );
  const activeJob = await page.locator('.entry-sheet .job-choice.is-active').innerText();
  assert.ok(activeJob.includes('老宅装修'), activeJob);
  const hours = await page
    .locator('.entry-sheet .field')
    .filter({ hasText: '工时（选填）' })
    .locator('input')
    .inputValue();
  assert.equal(hours, '6');
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
