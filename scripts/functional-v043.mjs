import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v043';
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

await step('删除工记后可以从 Toast 撤销', async () => {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(300);
  const rows = page.locator('.entry-row').filter({ hasText: '老宅装修' });
  const before = await rows.count();
  await rows.first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.toast').innerText()).includes('撤销'));
  await page.locator('.toast-action').click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.entry-row').filter({ hasText: '老宅装修' }).count(), before);
});

await step('取消休息后可以从 Toast 撤销', async () => {
  const restDate = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 2);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '记休息' }).click();
  await page.waitForTimeout(300);
  await page.getByLabel('休息日期', { exact: true }).fill(restDate);
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '取消休息' }).click();
  await page.waitForTimeout(300);
  await page.locator('.toast-action').click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '记休息' }).click();
  await page.waitForTimeout(300);
  await page.getByLabel('休息日期', { exact: true }).fill(restDate);
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole('button', { name: '取消休息' }).count(), 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
});

await step('工作设置修改后返回会提醒', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
  await page.waitForTimeout(300);
  await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(300);
  const nameInput = page.locator('.editor-card input.text-input').first();
  await nameInput.fill('老宅装修改名');
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.getByText('放弃这次修改？').count(), 1);
  await page.locator('.dialog .btn--ghost').click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(250);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.subpage').innerText()).includes('老宅装修'));
  assert.ok(!(await page.locator('.subpage').innerText()).includes('老宅装修改名'));
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
