import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.5.14';
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
await page.screenshot({ path: `${OUT}/01-qr-checksum.png` });
console.log('SHOT 01-qr-checksum');
await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '工资条', exact: true }).click();
await page.waitForTimeout(1000);
await page.locator('.payslip-options summary').click();
await page.waitForTimeout(250);
await page.locator('.payslip-template select').selectOption('amount');
await page.waitForTimeout(900);
await dismissToast();
await page.screenshot({ path: `${OUT}/02-payslip-template.png` });
console.log('SHOT 02-payslip-template');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
