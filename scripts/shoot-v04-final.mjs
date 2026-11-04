import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.4';
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
await page.waitForTimeout(400);
await shot('01-onboarding');

await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(3400);
await shot('02-home');

await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(400);
await shot('03-records');
await page.locator('.entry-row').filter({ hasText: '老宅装修' }).last().click();
await page.waitForTimeout(350);
await shot('11-entry-copy');
await page.getByRole('button', { name: '删除', exact: true }).click();
await page.waitForTimeout(200);
await page.locator('.dialog .btn--danger').click();
await page.waitForTimeout(300);
await shot('13-undo-delete');
await page.locator('.toast-action').click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '记一笔', exact: true }).click();
await page.waitForTimeout(300);
await page.locator('.entry-sheet .job-choice').filter({ hasText: '城南工地' }).click();
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);
await shot('12-discard-guard');
await page.locator('.dialog .btn--danger').click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '切换到日历视图' }).click();
await page.waitForTimeout(500);
await shot('04-calendar');
await page.getByRole('button', { name: '记休息' }).click();
await page.waitForTimeout(400);
await page.getByLabel('休息日期', { exact: true }).fill('2026-11-10');
await page.waitForTimeout(350);
await shot('05-rest-sheet');
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '记休息' }).click();
await page.waitForTimeout(300);
await page.getByLabel('休息日期', { exact: true }).fill('2026-11-01');
await page.waitForTimeout(300);
await page.getByRole('button', { name: '取消休息' }).click();
await page.waitForTimeout(300);
await shot('14-undo-rest');
await page.locator('.toast-action').click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '关闭提示' }).click().catch(() => {});
await page.waitForTimeout(250);

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
await page.waitForTimeout(400);
await shot('16-template-card');
await page.getByRole('button', { name: /长期工模板/ }).click();
await page.waitForTimeout(450);
await shot('17-template-editor');
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);
await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
await page.waitForTimeout(450);
await shot('06-job-editor');
await page.locator('.editor-card input.text-input').first().fill('老宅装修（未保存）');
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);
await shot('15-job-guard');
await page.locator('.dialog .btn--ghost').click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(250);
await page.locator('.dialog .btn--danger').click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(350);

await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.settle-card').filter({ hasText: '老宅装修' }).first().click();
await page.waitForTimeout(500);
await shot('07-fixed-settlement');

await page.getByRole('button', { name: '补记借支' }).click();
await page.waitForTimeout(300);
await page.locator('.big-money-input input').fill('300');
await page.getByRole('button', { name: '记上借支' }).click();
await page.waitForTimeout(450);
await page.getByRole('button', { name: '删除借支' }).last().click();
await page.waitForTimeout(250);
await page.locator('.dialog .btn--danger').click();
await page.waitForTimeout(300);
await shot('18-undo-advance');
await page.locator('.toast-action').click();
await page.waitForTimeout(450);
// 恢复后再删掉，避免影响这次结算金额
await page.getByRole('button', { name: '删除借支' }).last().click();
await page.waitForTimeout(250);
await page.locator('.dialog .btn--danger').click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '关闭提示' }).click().catch(() => {});
const bonus = page
  .locator('.detail-card')
  .filter({ hasText: '额外奖扣' })
  .locator('input')
  .first();
await bonus.fill('100');
await page.waitForTimeout(250);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);
await shot('19-draft-guard');
await page.locator('.dialog .btn--ghost').click();
await page.waitForTimeout(250);
await bonus.fill('');
await page.waitForTimeout(250);

await page.locator('.settle-footer .btn--primary').click();
await page.waitForTimeout(300);
await page.locator('.dialog .btn--primary').click();
await page.waitForTimeout(3400);
await shot('08-fixed-record');
await page.getByRole('button', { name: '工资条' }).click();
await page.waitForTimeout(1200);
await shot('09-fixed-payslip');
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(400);

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '深色', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '切换到日历视图' }).click();
await page.waitForTimeout(400);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(250);
await shot('10-calendar-dark');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
