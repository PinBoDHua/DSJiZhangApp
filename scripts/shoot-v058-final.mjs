import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.5.8';
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

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(3400);
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
  state.jobs.find((job) => job.name === '老宅装修').workWeekdays = [1, 2, 3, 4, 5, 6];
  localStorage.setItem('xinshi.state.v7', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: '批量补记' }).click();
await page.waitForTimeout(400);
await page.getByLabel('补记开始日期').fill('2026-11-10');
await page.getByLabel('补记结束日期').fill('2026-11-15');
await page.waitForTimeout(300);
await page.getByRole('button', { name: '清空' }).click();
await page.getByRole('button', { name: '全选' }).click();
await page.getByLabel('批量工时').fill('7');
await page.getByLabel('批量奖金').fill('20');
await page.getByLabel('批量扣款').fill('5');
await page.getByLabel('统一备注').fill('夜班补记');
await page.getByRole('button', { name: '保存模板' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/01-batch-template-deduction.png` });
console.log('SHOT 01-batch-template-deduction');

await page.locator('.batch-overrides summary').click();
await page.waitForTimeout(250);
await page.getByLabel('2026-11-10 工时').fill('9');
await page.getByLabel('2026-11-10 奖金').fill('30');
await page.getByLabel('2026-11-10 扣款').fill('1');
await page.locator('.batch-overrides').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-batch-day-overrides.png` });
console.log('SHOT 02-batch-day-overrides');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
