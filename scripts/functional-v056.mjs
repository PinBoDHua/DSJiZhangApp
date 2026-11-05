import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v056';
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
  localStorage.setItem('xinshi.state.v7', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: '批量补记' }).click();
await page.waitForTimeout(500);

await step('批量补记支持 7/14/30 天范围与全选清空', async () => {
  assert.deepEqual(await page.locator('.batch-range-tabs button').allInnerTexts(), [
    '未来 7 天',
    '未来 14 天',
    '未来 30 天',
  ]);
  await page.getByRole('button', { name: '未来 7 天' }).click();
  await page.waitForTimeout(350);
  const rows = await page.locator('.batch-plan-row').count();
  assert.ok(rows > 0, `rows=${rows}`);
  await page.getByRole('button', { name: '清空' }).click();
  await page.waitForTimeout(200);
  assert.ok((await page.locator('.batch-plan-summary').innerText()).includes('0'));
  assert.ok(await page.getByRole('button', { name: /补记 0 天/ }).isDisabled());
  await page.getByRole('button', { name: '全选' }).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.batch-plan-row.is-checked').count(), rows);
});

await step('批量补记可统一设置备注', async () => {
  const rows = await page.locator('.batch-plan-row').count();
  await page.getByLabel('统一备注').fill('夜班补记');
  await page.getByRole('button', { name: new RegExp(`补记 ${rows} 天`) }).click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator('.toast').innerText()).includes('已补记'));
  const noted = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('xinshi.state.v7')).entries.filter(
        (entry) => entry.note === '夜班补记',
      ).length,
  );
  assert.equal(noted, rows);
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
