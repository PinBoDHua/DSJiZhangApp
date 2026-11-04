import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v044';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
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

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('.settle-card').filter({ hasText: '老宅装修' }).first().click();
await page.waitForTimeout(500);

await step('删除借支后可以从 Toast 撤销', async () => {
  await page.getByRole('button', { name: '补记借支' }).click();
  await page.waitForTimeout(300);
  await page.locator('.big-money-input input').fill('300');
  await page.getByRole('button', { name: '记上借支' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.advance-row').count(), 1);
  await page.getByRole('button', { name: '删除借支' }).last().click();
  await page.waitForTimeout(250);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.toast').innerText()).includes('撤销'));
  await page.locator('.toast-action').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.advance-row').count(), 1);
});

await step('结算页额外奖扣未保存时返回会提醒', async () => {
  const bonus = page
    .locator('.detail-card')
    .filter({ hasText: '额外奖扣' })
    .locator('input')
    .first();
  await bonus.fill('100');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByText('放弃这次奖扣？').count(), 1);
  await page.locator('.dialog .btn--ghost').click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(200);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.settle-card').count()) > 0);
});

await step('长期工模板一次带入 3500 / 月休5 / 6h', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /长期工模板/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.editor-card input.text-input').first().inputValue(), '长期工');
  const preview = (await page.locator('.rule-preview').innerText()).replace(/\s+/g, '');
  assert.ok(preview.includes('月薪¥3500/月'), preview);
  assert.ok(preview.includes('固定月薪'), preview);
  assert.ok(preview.includes('月休5天'), preview);
  assert.ok(preview.includes('默认09:00–17:00'), preview);
  assert.ok(preview.includes('午休120分'), preview);
  await page.locator('.job-editor-footer .btn--primary').click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator('.subpage').innerText()).includes('长期工'));
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
