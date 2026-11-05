import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.5.10';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
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

async function dismissToast() {
  const close = page.locator('.toast-close');
  if ((await close.count()) > 0) {
    await close.first().click().catch(() => {});
    await page.waitForTimeout(250);
  }
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /工作管理/ }).click();
await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
await page.waitForTimeout(400);
const restGroup = page.getByRole('group', { name: '休息规则' });
await restGroup.scrollIntoViewIfNeeded();
await restGroup.getByRole('button', { name: '随机休息' }).click();
await page.waitForTimeout(250);
await dismissToast();
await page.screenshot({ path: `${OUT}/01-job-rest-policy.png` });
console.log('SHOT 01-job-rest-policy');
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /核对结算/ }).last().click();
await page.waitForTimeout(500);
const board = page.locator('.rest-month-card');
await board.scrollIntoViewIfNeeded();
await page.locator('.rest-month-day.is-empty').first().click();
await page.waitForTimeout(500);
await dismissToast();
await board.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-month-rest-board.png` });
console.log('SHOT 02-month-rest-board');

await page.locator('.settle-footer').getByRole('button', { name: '确认结算' }).click();
await page.waitForTimeout(250);
await page
  .getByRole('alertdialog', { name: '确认结算这一期？' })
  .getByRole('button', { name: '确认结算' })
  .click();
await page.waitForTimeout(900);
await dismissToast();
const restCard = page
  .locator('.detail-card')
  .filter({ has: page.getByRole('heading', { name: '本期休息', exact: true }) });
await restCard.scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/03-settlement-rest-dates.png` });
console.log('SHOT 03-settlement-rest-dates');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
