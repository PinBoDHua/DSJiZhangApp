import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v053';
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

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(300);
await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
await page.waitForTimeout(300);
await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
await page.waitForTimeout(350);
await page.getByRole('button', { name: '周一至周六' }).click();
await page.locator('.job-editor-footer .btn--primary').click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '关闭提示' }).click().catch(() => {});
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: '首页', exact: true }).click();
await page.waitForTimeout(300);

await step('首页显示未来 7 天排班和计划上班/休息', async () => {
  const card = compact(await page.locator('.plan-week-card').innerText());
  assert.ok(card.includes('接下来7天'), card);
  assert.ok(card.includes('老宅装修'), card);
  assert.ok(card.includes('上班'), card);
  assert.ok(card.includes('休息'), card);
  assert.ok(card.includes('已记'), card);
});

await step('日历标出计划上班日，并显示计划提示', async () => {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '切换到日历视图' }).click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.cal-plan-flag').count()) > 0);
  await page.getByRole('button', { name: /2026-11-09/ }).click();
  await page.waitForTimeout(250);
  assert.ok((await page.locator('.plan-day-note').innerText()).includes('计划上班'));
  await page.getByRole('button', { name: /2026-11-08/ }).click();
  await page.waitForTimeout(250);
  assert.ok((await page.locator('.plan-day-note').innerText()).includes('计划休息'));
});

await step('排休弹层给出冲突逐日清单', async () => {
  await page.getByRole('button', { name: '记休息' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /批量排休/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.plan-conflict-list').count(), 1);
  await page.locator('.plan-conflict-list summary').click();
  await page.waitForTimeout(250);
  const list = compact(await page.locator('.plan-conflict-list ul').innerText());
  assert.ok(/\d+月\d+日/.test(list), list);
  assert.ok(list.includes('已有工记'), list);
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
