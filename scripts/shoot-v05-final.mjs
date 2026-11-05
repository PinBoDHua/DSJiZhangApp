import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.5';
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

const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`SHOT ${name}`);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(3400);
await shot('01-home-payday');

// 让示例进入「超休 1 天」状态，方便展示 v0.5 的规则。
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('xinshi.state.v5'));
  const job = state.jobs.find((item) => item.name === '老宅装修');
  job.rule.overRestDeduct = true;
  job.rule.restDaysPerMonth = 1;
  localStorage.setItem('xinshi.state.v5', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(350);
await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
await page.waitForTimeout(350);
await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
await page.waitForTimeout(400);
await page.getByText('月休额度', { exact: true }).scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
await shot('02-payroll-settings');
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.settle-card').filter({ hasText: '老宅装修' }).first().click();
await page.waitForTimeout(450);
await page.locator('.overrest-card').scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
await shot('03-overrest-settlement');
await page.locator('.settle-footer .btn--primary').click();
await page.waitForTimeout(250);
await page.locator('.dialog .btn--primary').click();
await page.waitForTimeout(3400);

await page.getByRole('button', { name: '登记收款' }).click();
await page.waitForTimeout(350);
await page.locator('.big-money-input input').fill('1000');
await shot('04-payment-sheet');
await page.getByRole('button', { name: '保存收款' }).click();
await page.waitForTimeout(3200);
await page.locator('.payment-card').scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
await shot('05-payment-partial');

await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(450);
await page.locator('.month-settle-card').scrollIntoViewIfNeeded();
await page.waitForTimeout(250);
await shot('06-month-csv');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
