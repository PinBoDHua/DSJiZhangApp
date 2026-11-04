import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.2';
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
await page.waitForTimeout(3200);
await shot('02-home');

await page.locator('.today-timer-btn').click();
await page.waitForTimeout(350);
await page.locator('.timer-job-row').filter({ hasText: '顺丰夜班分拣' }).click();
await page.waitForTimeout(3200);
await shot('03-timer-running');
await page.locator('.timer-stop').click();
await page.waitForTimeout(500);
await shot('04-timer-entry');
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(3200);

await page.getByRole('button', { name: '记一笔工' }).click();
await page.waitForTimeout(400);
await shot('05-entry-editor');
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(350);
await shot('06-records');
await page.getByRole('button', { name: '切换到日历视图' }).click();
await page.waitForTimeout(400);
await shot('07-calendar');

await page.getByRole('button', { name: '统计', exact: true }).click();
await page.waitForTimeout(350);
await shot('08-stats');

await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await shot('09-settlements');
await page.locator('.settle-card').first().click();
await page.waitForTimeout(400);
await page.locator('.settle-footer .btn--primary').click();
await page.waitForTimeout(300);
await page.locator('.dialog .btn--primary').click();
await page.waitForTimeout(3200);
await shot('10-settlement-record');
await page.getByRole('button', { name: '工资条' }).click();
await page.waitForTimeout(1500);
await shot('11-payslip');
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(400);

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(400);
await page.evaluate(() => window.scrollTo(0, 0));
await shot('12-profile');
await page.getByRole('switch', { name: '每日记工提醒' }).click();
await page.waitForTimeout(300);
await page.locator('.settings-group').filter({ hasText: '提醒' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(350);
await shot('13-reminder');

// 深色模式
await page.evaluate(() => window.scrollTo(0, 0));
await page.getByRole('button', { name: '深色', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '首页', exact: true }).click();
await page.waitForTimeout(400);
await shot('14-home-dark');
await page.getByRole('button', { name: '统计', exact: true }).click();
await page.waitForTimeout(400);
await shot('15-stats-dark');
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(300);
await shot('16-records-dark');
await page.getByRole('button', { name: '切换到日历视图' }).click();
await page.waitForTimeout(300);
await shot('17-calendar-dark');
await page.getByRole('button', { name: '首页', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '记一笔工' }).click();
await page.waitForTimeout(400);
await shot('18-entry-dark');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
