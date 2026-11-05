import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v050';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
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

async function step(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: `${OUT}/failed-${name.replace(/\s+/g, '-')}.png` });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const compact = (value) => value.replace(/\s+/g, '');

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(500);

await step('首页显示发薪日提醒', async () => {
  const nudge = compact(await page.locator('.payday-nudge').innerText());
  assert.ok(nudge.includes('发薪'), nudge);
  assert.ok(nudge.includes('老宅装修'), nudge);
});

await step('超休规则可开启并在结算单里扣款', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
  await page.waitForTimeout(300);
  await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(350);
  await page
    .locator('.field')
    .filter({ hasText: '月休额度' })
    .locator('input')
    .fill('1');
  await page.getByRole('switch', { name: /超休扣款/ }).click();
  await page.locator('.job-editor-footer .btn--primary').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.settle-card').filter({ hasText: '老宅装修' }).first().click();
  await page.waitForTimeout(450);
  const card = compact(await page.locator('.overrest-card').innerText());
  assert.ok(card.includes('超休1天'), card);
  const net = compact(await page.locator('.settle-footer-amount').innerText());
  assert.ok(net.includes('3,340.91'), net);
  await page.locator('.overrest-card .switch').click();
  await page.waitForTimeout(250);
  assert.ok(compact(await page.locator('.settle-footer-amount').innerText()).includes('3,500.00'));
  await page.locator('.overrest-card .switch').click();
  await page.waitForTimeout(200);
  await page.locator('.overrest-field input').fill('100');
  await page.waitForTimeout(250);
  assert.ok(compact(await page.locator('.settle-footer-amount').innerText()).includes('3,400.00'));
  await page.locator('.settle-footer .btn--primary').click();
  await page.waitForTimeout(250);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(700);
  const detail = compact(await page.locator('.amount-list').innerText());
  assert.ok(detail.includes('超休扣款'), detail);
  assert.ok(detail.includes('100.00'), detail);
});

await step('结算单可登记部分收款并导出 CSV', async () => {
  const before = compact(await page.locator('.payment-card').innerText());
  assert.ok(before.includes('待发'), before);
  await page.getByRole('button', { name: '登记收款' }).click();
  await page.waitForTimeout(300);
  await page.locator('.big-money-input input').fill('1000');
  await page.getByRole('button', { name: '保存收款' }).click();
  await page.waitForTimeout(500);
  const after = compact(await page.locator('.payment-card').innerText());
  assert.ok(after.includes('部分发放'), after);
  assert.ok(after.includes('已收¥1,000.00'), after);
  await page.getByRole('button', { name: '修改收款' }).click();
  await page.waitForTimeout(300);
  await page.locator('.big-money-input input').fill('3400');
  await page.getByRole('button', { name: '保存收款' }).click();
  await page.waitForTimeout(450);
  const paid = compact(await page.locator('.payment-card').innerText());
  assert.ok(paid.includes('已发'), paid);
  assert.ok(paid.includes('已收¥3,400.00'), paid);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(500);
  const monthCard = compact(await page.locator('.month-settle-card').innerText());
  assert.ok(monthCard.includes('1张结算单'), monthCard);
  assert.ok(monthCard.includes('已收¥3,400.00'), monthCard);
  assert.ok(monthCard.includes('待收¥0.00'), monthCard);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出 CSV/ }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), '薪时-工资流水-2026-11.csv');
  const csv = await readFile(await download.path(), 'utf8');
  assert.ok(csv.includes('超休扣款'));
  assert.ok(csv.includes('老宅装修,2026-11-01,2026-11-30'));
  assert.ok(csv.includes('已发'));
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
