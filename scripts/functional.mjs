import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ARTIFACTS = 'test-results';
await mkdir(ARTIFACTS, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
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
    await page.screenshot({ path: `${ARTIFACTS}/failed-${name.replace(/\s+/g, '-')}.png` });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const text = async (selector) => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ');
const hasText = async (selector, expected) => {
  const value = await text(selector);
  const compactValue = value.replace(/\s+/g, '');
  const compactExpected = expected.replace(/\s+/g, '');
  assert.ok(
    compactValue.includes(compactExpected),
    `${selector} 应包含 ${expected}，实际：${value}`,
  );
};

await step('onboarding 建工作', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('李师傅（选填）').fill('王师傅');
  await page.getByPlaceholder('比如：城南工地 / 顺丰分拣').fill('测试工地');
  await page.getByRole('button', { name: '日薪', exact: true }).click();
  await page.locator('.onboarding-card input[type=number]').fill('300');
  await page.getByRole('button', { name: /开始记工/ }).click();
  await page.waitForTimeout(600);
  await hasText('.welcome', '王师傅');
});

await step('记一笔日薪加班', async () => {
  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(400);
  await page.locator('.ot-manual input').fill('1');
  await page.locator('.entry-save').click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(500);
  await hasText('.entry-row-amount', '356.25');
});

await step('结算并生成快照', async () => {
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(500);
  await hasText('.settle-card', '356.25');
  await page.locator('.settle-card').first().click();
  await page.waitForTimeout(500);
  await hasText('.slip-amount', '356.25');
  await page.locator('.settle-footer .btn--primary').click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(700);
  await hasText('.slip--done', '356.25');
  await hasText('.status-chip', '已结算');
});

await step('已结算记录被锁定', async () => {
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(400);
  await hasText('.locked-note', '已结算');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
});

await step('撤销结算解锁', async () => {
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.history-row').first().click();
  await page.waitForTimeout(400);
  await page.locator('.record-footer .btn--danger-text').click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(700);
  await hasText('.receipt', '356.25');
});

await step('借支抵扣与再次结算', async () => {
  await page.locator('.settle-card').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /补记借支/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.big-money-input input').fill('100');
  await page.getByRole('button', { name: '记上借支' }).click();
  await page.waitForTimeout(600);
  await hasText('.slip-amount', '256.25');
  await page.locator('.settle-footer .btn--primary').click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(700);
  await hasText('.amount-list', '借支抵扣');
  await hasText('.amount-list', '100.00');
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
});

await step('刷新后数据仍在', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await hasText('.history-amount', '256.25');
});

let backupPath = '';
await step('导出备份', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(400);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.settings-row').filter({ hasText: '导出备份' }).first().click();
  const download = await downloadPromise;
  backupPath = `${ARTIFACTS}/backup.json`;
  await download.saveAs(backupPath);
  const payload = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(payload.app, 'xinshi');
  assert.equal(payload.version, 7);
  assert.ok(payload.data.entries.length >= 1);
  assert.ok(payload.data.settlements.length >= 1);
});

await step('导入备份', async () => {
  await page.locator('input[type=file]').setInputFiles(backupPath);
  await page.waitForTimeout(500);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await hasText('.history-amount', '256.25');
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();

// 离线验证：首次在线加载后，断网刷新仍能打开
const offlineContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
});
const offlinePage = await offlineContext.newPage();
await offlinePage.addInitScript(() => localStorage.setItem('xinshi.privacyConsent', '2026-11-05'));
await offlinePage.goto(BASE, { waitUntil: 'networkidle' });
await offlinePage.getByRole('button', { name: /先看看示例数据/ }).click();
await offlinePage.waitForTimeout(500);
await offlinePage.evaluate(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 2500);
    });
  }
});
await offlinePage.reload({ waitUntil: 'networkidle' });
await offlineContext.setOffline(true);
await offlinePage.reload({ waitUntil: 'domcontentloaded' });
await offlinePage.waitForTimeout(800);
const offlineHome = await offlinePage.locator('.hero-card').count();
assert.ok(offlineHome === 1, '离线刷新后应能打开首页');
await offlinePage.screenshot({ path: `${ARTIFACTS}/offline-home.png` });
console.log('PASS 离线刷新可用');
await offlineContext.close();

await browser.close();

// 留一份备份，便于人工复查
await writeFile(`${ARTIFACTS}/summary.txt`, 'functional checks passed\n');
