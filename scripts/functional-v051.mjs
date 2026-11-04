import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v051';
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

const compact = (value) => value.replace(/\s+/g, '');

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(300);
await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '新建工作', exact: true }).last().click();
await page.waitForTimeout(300);
await page.getByPlaceholder('例如：城南工地 / 顺丰分拣').fill('空工作');
await page.locator('.job-editor-footer .btn--primary').click();
await page.waitForTimeout(500);

await step('删除空工作后可以撤销，也能在回收站恢复', async () => {
  await page.locator('.job-manage-card').filter({ hasText: '空工作' }).click();
  await page.waitForTimeout(300);
  await page.getByText('删除工作', { exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /删除工作/ }).click();
  await page.waitForTimeout(200);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(350);
  assert.ok((await page.locator('.toast').innerText()).includes('回收站'));
  await page.locator('.toast-action').click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.subpage').innerText()).includes('空工作'));

  await page.locator('.job-manage-card').filter({ hasText: '空工作' }).click();
  await page.waitForTimeout(300);
  await page.getByText('删除工作', { exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /删除工作/ }).click();
  await page.waitForTimeout(200);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(350);
  await page.locator('.trash-entry').click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.trash-list').innerText()).includes('空工作'));
  await page.getByRole('button', { name: /恢复 空工作/ }).click();
  await page.waitForTimeout(350);
  assert.ok((await page.locator('.subpage').innerText()).includes('空工作'));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(250);
});

await step('可以一次排好未来休息日', async () => {
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '记休息' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /批量排休/ }).click();
  await page.waitForTimeout(400);
  assert.equal(await page.getByText('排休计划', { exact: true }).count(), 1);
  await page.locator('.plan-day').filter({ hasText: '10' }).first().click();
  await page.locator('.plan-day').filter({ hasText: '11' }).first().click();
  await page.waitForTimeout(200);
  assert.ok(compact(await page.locator('.plan-summary').innerText()).includes('已选2天'));
  await page.getByRole('button', { name: /保存计划/ }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.toast').innerText()).includes('已排 2 天休息'));
  assert.ok(compact(await page.locator('.hero-caption').innerText()).includes('休4/5天'));
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
