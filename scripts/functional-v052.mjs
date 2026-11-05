import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v052';
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

const compact = (value) => value.replace(/\s+/g, '');

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(500);

await step('周一至周六模板能自动补选周日并提示冲突/超额', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
  await page.waitForTimeout(300);
  await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: '周一至周六' }).click();
  await page.locator('.job-editor-footer .btn--primary').click();
  await page.waitForTimeout(500);
  const state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.state.v7')),
  );
  assert.deepEqual(
    state.jobs.find((item) => item.name === '老宅装修').workWeekdays,
    [1, 2, 3, 4, 5, 6],
  );
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '记休息' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /批量排休/ }).click();
  await page.waitForTimeout(400);
  const row = compact(await page.locator('.plan-template-row').innerText());
  assert.ok(row.includes('周一'), row);
  assert.ok(row.includes('周六'), row);
  await page.getByRole('button', { name: '按周排班选休息日' }).click();
  await page.waitForTimeout(250);
  const summary = compact(await page.locator('.plan-summary').innerText());
  assert.ok(summary.includes('已选4天'), summary);
  const warning = compact(await page.locator('.plan-warning').innerText());
  assert.ok(warning.includes('已有工记'), warning);
  assert.ok(warning.includes('超过额度5天'), warning);
  await page.getByRole('button', { name: /保存计划/ }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.toast').innerText()).includes('超过本月额度'));
  assert.ok(compact(await page.locator('.hero-caption').innerText()).includes('休6/5天'));
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
