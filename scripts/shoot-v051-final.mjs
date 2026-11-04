import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.5.1';
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

const shot = async (name) => {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`SHOT ${name}`);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(3400);

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(300);
await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '新建工作', exact: true }).last().click();
await page.waitForTimeout(300);
await page.getByPlaceholder('例如：城南工地 / 顺丰分拣').fill('临时工作');
await page.locator('.job-editor-footer .btn--primary').click();
await page.waitForTimeout(500);
await page.locator('.job-manage-card').filter({ hasText: '临时工作' }).click();
await page.waitForTimeout(300);
await page.getByText('删除工作', { exact: true }).scrollIntoViewIfNeeded();
await page.getByRole('button', { name: /删除工作/ }).click();
await page.waitForTimeout(200);
await page.locator('.dialog .btn--danger').click();
await page.waitForTimeout(3400);
await page.getByRole('button', { name: '关闭提示' }).click().catch(() => {});
await page.waitForTimeout(250);
await shot('01-jobs-trash-entry');
await page.locator('.trash-entry').click();
await page.waitForTimeout(300);
await shot('02-trash-sheet');
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '首页', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '记休息' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /批量排休/ }).click();
await page.waitForTimeout(400);
await page.locator('.plan-day').filter({ hasText: '10' }).first().click();
await page.locator('.plan-day').filter({ hasText: '11' }).first().click();
await page.waitForTimeout(250);
await shot('03-rest-plan');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
