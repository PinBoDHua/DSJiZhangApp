import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.5.6';
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
await page.getByRole('button', { name: '未来 7 天' }).click();
await page.waitForTimeout(300);
await page.getByLabel('统一备注').fill('夜班补记');
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/01-batch-range-note.png` });
console.log('SHOT 01-batch-range-note');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
