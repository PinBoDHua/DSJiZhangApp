import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v057';
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

function addDays(iso, days) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function weekdayOf(iso) {
  return new Date(`${iso}T12:00:00`).getDay();
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(500);
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
  state.jobs.find((job) => job.name === '老宅装修').workWeekdays = [1, 2, 3, 4, 5, 6];
  localStorage.setItem('xinshi.state.v7', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const today = await page.evaluate(() => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
});
// 任意连续 6 天恰好包含一个周日，正好有 5 个可补记的上班日。
const rangeStart = addDays(today, 4);
const rangeEnd = addDays(today, 9);
const rangeDates = Array.from({ length: 6 }, (_, index) => addDays(rangeStart, index)).filter(
  (date) => weekdayOf(date) !== 0,
);
const futureSevenEnd = addDays(today, 6);
const outOfRangeDates = rangeDates.filter((date) => date > futureSevenEnd);
await page.getByRole('button', { name: '批量补记' }).click();
await page.waitForTimeout(500);

await step('自定义起止日期并保留跨范围勾选', async () => {
  await page.getByLabel('补记开始日期').fill(rangeStart);
  await page.getByLabel('补记结束日期').fill(rangeEnd);
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.batch-plan-row').count(), 5);
  await page.getByRole('button', { name: '清空' }).click();
  await page.getByRole('button', { name: '全选' }).click();
  await page.waitForTimeout(200);
  assert.ok((await page.locator('.batch-plan-summary').innerText()).includes('5'));
  await page.getByRole('button', { name: '未来 7 天' }).click();
  await page.waitForTimeout(300);
  const summary = await page.locator('.batch-plan-summary').innerText();
  assert.ok(summary.includes('5'), summary);
  const out = await page.locator('.batch-out-range').innerText();
  assert.ok(out.includes(`范围外已选 ${outOfRangeDates.length} 天`), out);
});

await step('批量改工时 / 奖金 / 备注并生成', async () => {
  await page.getByLabel('批量工时').fill('8');
  await page.getByLabel('批量奖金').fill('50');
  await page.getByLabel('统一备注').fill('夜班补记');
  await page.getByRole('button', { name: '补记 5 天' }).click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator('.toast').innerText()).includes('已补记'));
  const entries = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.state.v7')).entries.filter(
      (entry) => entry.note === '夜班补记',
    ),
  );
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map((entry) => entry.date).sort(), rangeDates);
  assert.ok(entries.every((entry) => entry.hours === 8));
  assert.ok(entries.every((entry) => entry.bonus === 50));
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
