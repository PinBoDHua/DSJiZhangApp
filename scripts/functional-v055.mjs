import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v055';
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

await step('排班岗位选择会被记住', async () => {
  await page.locator('.plan-week-tabs button').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(300);
  assert.ok(
    (await page.locator('.plan-week-head').innerText()).includes('老宅装修'),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  assert.ok(
    (await page.locator('.plan-week-head').innerText()).includes('老宅装修'),
  );
  assert.ok((await page.evaluate(() => localStorage.getItem('xinshi.planJobId'))) !== null);
});

await step('批量补记未来计划日会生成对应工记', async () => {
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem('xinshi.state.v7')).entries.length,
  );
  await page.getByRole('button', { name: '批量补记' }).click();
  await page.waitForTimeout(500);
  const rows = await page.locator('.batch-plan-row').count();
  assert.ok(rows > 0, `rows=${rows}`);
  const summary = await page.locator('.batch-plan-summary').innerText();
  assert.ok(summary.includes(`${rows}`), summary);
  await page.getByRole('button', { name: new RegExp(`补记 ${rows} 天`) }).click();
  await page.waitForTimeout(800);
  assert.ok((await page.locator('.toast').innerText()).includes('已补记'));
  const after = await page.evaluate(
    () => JSON.parse(localStorage.getItem('xinshi.state.v7')).entries.length,
  );
  assert.equal(after, before + rows);
  const statuses = await page.locator('.plan-week-grid').innerText();
  assert.ok(statuses.includes('已记'), statuses);
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
