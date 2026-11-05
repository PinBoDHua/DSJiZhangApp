import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.5.12';
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
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '月度考勤' }).click();
await page.waitForTimeout(500);
await dismissToast();
await page.screenshot({ path: `${OUT}/01-attendance-grid.png` });
console.log('SHOT 01-attendance-grid');

await page.getByRole('button', { name: /11月10日 老宅装修 未记/ }).click();
await page.waitForTimeout(400);
await page.locator('.attendance-day-sheet').getByRole('button', { name: '半天', exact: true }).click();
await page.waitForTimeout(250);
await dismissToast();
await page.screenshot({ path: `${OUT}/02-day-sheet.png` });
console.log('SHOT 02-day-sheet');
await page.locator('.attendance-day-sheet').getByRole('button', { name: '标为休息', exact: true }).click();
await page.waitForTimeout(400);

await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /核对结算/ }).last().click();
await page.waitForTimeout(500);
await page.locator('.rest-month-card').scrollIntoViewIfNeeded();
await page.getByRole('button', { name: /11月12日未记/ }).click();
await page.waitForTimeout(300);
await page
  .locator('.attendance-day-sheet')
  .getByRole('button', { name: '补记工', exact: true })
  .click();
await page.waitForTimeout(500);
await page.locator('.entry-save').click();
await page.waitForTimeout(900);
await dismissToast();
await page.locator('.slip').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/03-settlement-add-entry.png` });
console.log('SHOT 03-settlement-add-entry');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
