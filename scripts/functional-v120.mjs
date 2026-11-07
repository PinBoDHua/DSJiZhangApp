import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v120';
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
  acceptDownloads: true,
});
await context.addInitScript(() => localStorage.setItem('xinshi.privacyConsent', '2026-11-05'));
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
    await page.screenshot({ path: `${OUT}/failed-${name.replace(/\s+/g, '-')}.png`, fullPage: true });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function openTab(name) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(500);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(1600);

await step(`分类统计与 ${APP_VERSION} 版本`, async () => {
  await openTab('统计');
  await page.getByRole('button', { name: '本月', exact: true }).click();
  await page.getByText('分类统计', { exact: true }).waitFor();
  assert.ok((await page.locator('.category-card').innerText()).includes('月薪'));
  await page.screenshot({ path: `${OUT}/01-category-stats.png`, fullPage: true });
  await openTab('我的');
  assert.ok((await page.locator('body').innerText()).includes(`v${APP_VERSION}`));
});

await step('预算设置、首页提醒和统计进度', async () => {
  await page.getByRole('button', { name: /月度预算提醒/ }).click();
  await page.getByLabel('本月收入目标（元，选填）').fill('4000');
  await page.getByRole('switch', { name: '启用月度预算提醒' }).click();
  await page.getByRole('button', { name: '保存预算' }).click();
  await page.waitForTimeout(400);
  await openTab('首页');
  await page.getByText('本月预算提醒', { exact: true }).waitFor();
  assert.ok((await page.locator('.budget-nudge').innerText()).includes('接近目标'));
  await openTab('统计');
  await page.getByRole('button', { name: '本月', exact: true }).click();
  await page.getByText('本月预算', { exact: true }).waitFor();
  assert.ok(/4,000/.test(await page.locator('.budget-card').innerText()));
  await page.screenshot({ path: `${OUT}/02-budget.png`, fullPage: true });
});

let recurringRuleId = '';
await step('周期规则预览、生成、幂等与来源标记', async () => {
  await openTab('记录');
  await page.getByRole('button', { name: '周期记工', exact: true }).click();
  await page.getByRole('button', { name: '新建规则', exact: true }).click();
  await page.getByLabel('周期规则工作').selectOption({ label: '顺丰夜班分拣' });
  await page.getByRole('button', { name: '每天', exact: true }).click();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('en-CA');
  await page.getByLabel('开始日期').fill(yesterday);
  await page.getByLabel('每次工时').fill('8');
  await page.getByRole('button', { name: '保存规则' }).click();
  await page.waitForTimeout(450);
  assert.ok((await page.locator('.recurring-summary').innerText()).includes('1 笔待补记'));
  await page.getByRole('button', { name: /确认补记到期工记/ }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.toast').innerText()).includes('已补记 1 笔'));
  assert.ok((await page.locator('.recurring-summary').innerText()).includes('0 笔待补记'));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('xinshi.state.v7') || '{}'));
  recurringRuleId = stored.recurringRules?.[0]?.id || '';
  assert.ok(recurringRuleId);
  await page.screenshot({ path: `${OUT}/03-recurring.png`, fullPage: true });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.locator('.entry-row').filter({ hasText: '顺丰夜班分拣' }).first().click();
  await page.locator('.detail-tags .is-recurring').waitFor();
  await page.keyboard.press('Escape');
});

await step('完整工记 CSV 实际下载且包含周期来源', async () => {
  await openTab('我的');
  await page.getByRole('button', { name: /数据与安全/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /完整工记 CSV/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const csv = await readFile(path, 'utf8');
  assert.ok(csv.includes('记录ID'));
  assert.ok(csv.includes('完整计薪快照') === false, '表头不应含说明文字');
  assert.ok(csv.includes('周期规则ID'));
  assert.ok(csv.includes(recurringRuleId));
  assert.ok(csv.includes('合计(单笔折算参考)'));
  await page.screenshot({ path: `${OUT}/04-export.png`, fullPage: true });
});

await step('周期页和统计页 320px 无横向溢出', async () => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await openTab('记录');
  await page.getByRole('button', { name: '周期记工', exact: true }).click();
  const recurringOverflow = await page.locator('.subpage-inner').evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  assert.equal(recurringOverflow, false);
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await openTab('统计');
  const statsOverflow = await page.locator('.stats-page').evaluate((element) => element.scrollWidth > element.clientWidth + 1);
  assert.equal(statsOverflow, false);
  assert.deepEqual(errors, []);
});

const brokenContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
await brokenContext.addInitScript(() => {
  localStorage.setItem('xinshi.privacyConsent', '2026-11-05');
  localStorage.setItem('xinshi.state.v7', '{broken-original');
});
const broken = await brokenContext.newPage();
await step('损坏账本停止写入并可导出原文', async () => {
  await broken.goto(BASE, { waitUntil: 'networkidle' });
  await broken.getByText('账本需要人工恢复', { exact: true }).waitFor();
  assert.equal(await broken.evaluate(() => localStorage.getItem('xinshi.state.v7')), '{broken-original');
  const downloadPromise = broken.waitForEvent('download');
  await broken.getByRole('button', { name: /导出原始账本/ }).click();
  const download = await downloadPromise;
  const raw = await readFile(await download.path(), 'utf8');
  assert.equal(raw, '{broken-original');
});
await brokenContext.close();
await browser.close();
console.log(`ALL PASS v${APP_VERSION}`);
