import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.3';
await mkdir(OUT, { recursive: true });
await mkdir('test-results-v03', { recursive: true });

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
await page.waitForTimeout(400);
await shot('01-onboarding');

await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(3200);
await shot('02-home');

await page.locator('.job-card').last().scrollIntoViewIfNeeded();
await page.waitForTimeout(450);
await shot('03-home-jobs');

await page.getByRole('button', { name: '记一笔工' }).click();
await page.waitForTimeout(400);
await page.locator('.entry-sheet .job-choice').filter({ hasText: '礼盒包装' }).click();
await page.waitForTimeout(350);
await page.getByLabel('计件数量').fill('120');
const hoursField = page
  .locator('.entry-sheet .field')
  .filter({ hasText: '工时（选填）' })
  .locator('input');
await hoursField.fill('3');
await page.waitForTimeout(350);
await shot('04-piece-entry');
await page.locator('.entry-save').click();
await page.waitForTimeout(3400);

await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.entry-row').filter({ hasText: '礼盒包装' }).first().click();
await page.waitForTimeout(400);
await shot('05-piece-detail');
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);

await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.settle-card').filter({ hasText: '礼盒包装' }).first().click();
await page.waitForTimeout(450);
await shot('06-piece-settlement');
await page.locator('.settle-footer .btn--primary').click();
await page.waitForTimeout(300);
await page.locator('.dialog .btn--primary').click();
await page.waitForTimeout(3200);
await shot('07-piece-record');
await page.getByRole('button', { name: '工资条' }).click();
await page.waitForTimeout(1300);
await shot('08-payslip-pdf');
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(400);

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.settings-group').filter({ hasText: '数据' }).scrollIntoViewIfNeeded();
await page.waitForTimeout(350);
await page.locator('.settings-row').filter({ hasText: '导出加密备份' }).click();
await page.waitForTimeout(350);
await page.getByLabel('备份密码', { exact: true }).fill('screenshot-pass-123');
await page.getByLabel('再输一次', { exact: true }).fill('screenshot-pass-123');
await shot('09-encrypted-export');
const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
await page.locator('.sheet-footer .btn--primary').filter({ hasText: '导出加密备份' }).click();
const download = await downloadPromise;
await download.saveAs('test-results-v03/screenshot-backup.enc.json');
await page.waitForTimeout(3200);
await page.locator('.settings-group').filter({ hasText: '数据' }).scrollIntoViewIfNeeded();
await shot('10-profile-data');

await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
await page.waitForTimeout(400);
await page.locator('.job-manage-card').filter({ hasText: '礼盒包装' }).click();
await page.waitForTimeout(450);
await shot('11-job-editor-piece');
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(400);

await page.evaluate(() =>
  localStorage.setItem(
    'xinshi.lastBackup',
    new Date(Date.now() - 20 * 86_400_000).toISOString(),
  ),
);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await shot('12-backup-nudge');

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '深色', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '首页', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '记一笔工' }).click();
await page.waitForTimeout(400);
await page.locator('.entry-sheet .job-choice').filter({ hasText: '礼盒包装' }).click();
await page.waitForTimeout(300);
await page.getByLabel('计件数量').fill('80');
await page.waitForTimeout(350);
await shot('13-piece-entry-dark');

console.log(errors.length ? `CONSOLE ERRORS\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
