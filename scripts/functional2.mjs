import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
});
const page = await context.newPage();
await page.clock.install({ time: new Date('2026-11-06T09:00:00+08:00') });
await page.addInitScript(() => localStorage.setItem('xinshi.privacyConsent', '2026-11-05'));
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

const compact = (value) => value.replace(/\s+/g, '');
async function step(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: `test-results/failed2-${name.replace(/\s+/g, '-')}.png` });
    console.error(`FAIL ${name}`);
    throw error;
  }
}
async function expectText(selector, expected) {
  const value = compact(await page.locator(selector).first().innerText());
  assert.ok(value.includes(compact(expected)), `${selector} 应包含 ${expected}，实际：${value}`);
}

await step('建小时工并记两笔', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('李师傅（选填）').fill('小时工');
  await page.getByPlaceholder('比如：城南工地 / 顺丰分拣').fill('时薪测试');
  await page.locator('.onboarding-card input[type=number]').fill('25');
  await page.getByRole('button', { name: /开始记工/ }).click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(300);
  await expectText('.entry-preview-money', '200.00');
  await page.locator('.entry-save').click();
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(300);
  const times = page.locator('.time-box input[type=time]');
  await times.nth(0).fill('09:00');
  await times.nth(1).fill('19:00');
  await page.waitForTimeout(250);
  await expectText('.entry-preview-money', '237.50');
  await page.locator('.entry-save').click();
  await page.waitForTimeout(600);
});

await step('编辑工记金额重新计算', async () => {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '编辑' }).click();
  await page.waitForTimeout(400);
  const times = page.locator('.time-box input[type=time]');
  await times.nth(1).fill('18:00');
  await page.waitForTimeout(250);
  await page.locator('.entry-save').click();
  await page.waitForTimeout(600);
  const amounts = await page.locator('.entry-row-amount').allInnerTexts();
  assert.ok(amounts.every((value) => compact(value).includes('200.00')), `编辑后金额异常：${amounts}`);
});

await step('删除工记', async () => {
  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(350);
  await page.locator('.detail-actions .btn--danger-text').click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.entry-row').count(), 1);
});

await step('调价不影响历史快照', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /工作管理/ }).click();
  await page.waitForTimeout(400);
  await page.locator('.job-manage-card').first().click();
  await page.waitForTimeout(400);
  await page.locator('.money-input input').fill('30');
  await page.getByRole('button', { name: '保存' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(300);
  await expectText('.entry-preview-money', '240.00');
  await page.locator('.entry-save').click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(400);
  const amounts = await page.locator('.entry-row-amount').allInnerTexts();
  const flat = amounts.map(compact);
  assert.ok(flat.some((value) => value.includes('240.00')), `新单价应 240：${amounts}`);
  assert.ok(flat.some((value) => value.includes('200.00')), `历史应保留 200：${amounts}`);
});

await step('结算后禁止往已结周期补记', async () => {
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.settle-card').first().click();
  await page.waitForTimeout(400);
  await expectText('.slip-amount', '440.00');
  await page.locator('.settle-footer .btn--primary').click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(300);
  await page.locator('.entry-save').click();
  await page.waitForTimeout(400);
  await expectText('.form-error', '这个周期已经结算过了');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(300);
});

await step('隐藏金额', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.switch').first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(400);
  await expectText('.hero-money', '••••');
});

await step('清空数据回到引导', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-row').filter({ hasText: '清空所有数据' }).click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(800);
  await page.locator('.onboarding').waitFor();
  await expectText('.onboarding-copy h1', '记工算薪');
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await page.screenshot({ path: 'test-results/functional2-final.png' });
await context.close();
await browser.close();
