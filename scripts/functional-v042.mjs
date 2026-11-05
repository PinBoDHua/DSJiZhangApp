import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v042';
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

await step('首页展示真实工时与月休额度', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(500);
  const caption = compact(await page.locator('.hero-caption').innerText());
  assert.ok(caption.includes('已记2天'), caption);
  assert.ok(caption.includes('休2/5天'), caption);
  const stats = compact(await page.locator('.hero-stats').innerText());
  assert.ok(stats.includes('12h'), stats);
  assert.ok(stats.includes('2天'), stats);
  assert.ok(stats.includes('0h'), stats);
});

await step('填写后关闭会提醒，不会静默丢数据', async () => {
  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(300);
  await page.locator('.entry-sheet .job-choice').filter({ hasText: '城南工地' }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByText('放弃这次编辑？').count(), 1);
  await page.locator('.dialog .btn--ghost').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.entry-sheet').count(), 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.entry-sheet').count(), 0);
});

await step('过去的工记可以一键复制到今天', async () => {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(300);
  const rows = page.locator('.entry-row').filter({ hasText: '老宅装修' });
  const before = await rows.count();
  await rows.last().click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('button', { name: '复制到今天' }).count(), 1);
  await page.getByRole('button', { name: '复制到今天' }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.toast').innerText()).includes('已复制到今天'));
  assert.equal(await page.locator('.entry-row').filter({ hasText: '老宅装修' }).count(), before + 1);
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
