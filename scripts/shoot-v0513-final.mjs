import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.5.13';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
  acceptDownloads: true,
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
await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /核对结算/ }).last().click();
await page.waitForTimeout(500);
await page.locator('.settle-footer').getByRole('button', { name: '确认结算' }).click();
await page.waitForTimeout(250);
await page
  .getByRole('alertdialog', { name: '确认结算这一期？' })
  .getByRole('button', { name: '确认结算' })
  .click();
await page.waitForTimeout(900);
await dismissToast();

await page.getByRole('button', { name: '二维码', exact: true }).click();
await page.waitForTimeout(500);
await dismissToast();
await page.screenshot({ path: `${OUT}/01-share-qr.png` });
console.log('SHOT 01-share-qr');
await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '工资条', exact: true }).click();
await page.waitForTimeout(1000);
await page.locator('.payslip-options summary').click();
await page.waitForTimeout(250);
await page.getByLabel('奖金补贴').uncheck();
await page.waitForTimeout(900);
await dismissToast();
await page.screenshot({ path: `${OUT}/02-payslip-options.png` });
console.log('SHOT 02-payslip-options');
await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '月度考勤' }).click();
await page.waitForTimeout(500);
await dismissToast();
await page.screenshot({ path: `${OUT}/03-attendance-csv.png` });
console.log('SHOT 03-attendance-csv');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
