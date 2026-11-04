import { chromium } from 'playwright-core';
import { mkdir, readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v02';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
  acceptDownloads: true,
  permissions: ['notifications'],
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

await step('建小时工并开始计时', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('李师傅（选填）').fill('计时测试');
  await page.getByPlaceholder('比如：城南工地 / 顺丰分拣').fill('计时工地');
  await page.locator('.onboarding-card input[type=number]').fill('30');
  await page.getByRole('button', { name: /开始记工/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '开始计时' }).click();
  await page.waitForTimeout(700);
  await page.locator('.timer-live').waitFor();
  assert.equal(await page.locator('.nav-timer-dot').count(), 1);
});

await step('刷新后计时继续', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('.timer-live').waitFor();
  assert.equal(await page.locator('.nav-timer-dot').count(), 1);
  const before = await page.locator('.timer-clock').innerText();
  await page.waitForTimeout(1200);
  const after = await page.locator('.timer-clock').innerText();
  assert.notEqual(before, after, '计时器应持续走动');
});

await step('结束计时带出工记并保存', async () => {
  await page.locator('.timer-stop').click();
  await page.waitForTimeout(500);
  const inputs = page.locator('.time-box input[type=time]');
  const start = await inputs.nth(0).inputValue();
  const [h, m] = start.split(':').map(Number);
  const endMinutes = (h * 60 + m + 60) % 1440;
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(
    endMinutes % 60,
  ).padStart(2, '0')}`;
  await inputs.nth(1).fill(end);
  await page.waitForTimeout(250);
  await page.locator('.entry-save').click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(400);
  const amount = compact(await page.locator('.entry-row-amount').first().innerText());
  assert.ok(amount.includes('30.00'), `1 小时应记 30 元，实际 ${amount}`);
});

await step('日历视图与按日明细', async () => {
  await page.getByRole('button', { name: '切换到日历视图' }).click();
  await page.waitForTimeout(400);
  await page.locator('.calendar-grid').waitFor();
  const days = await page.locator('.cal-day.has-entry').count();
  assert.ok(days >= 1);
  await page.locator('.cal-day.has-entry').last().click();
  await page.waitForTimeout(300);
  await page.locator('.calendar-detail-head').waitFor();
  await page.getByRole('button', { name: '切换到列表视图' }).click();
  await page.waitForTimeout(300);
});

await step('结算并生成工资条图片', async () => {
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.settle-card').first().click();
  await page.waitForTimeout(400);
  await page.locator('.settle-footer .btn--primary').click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '工资条' }).click();
  await page.waitForTimeout(900);
  const loaded = await page.locator('.payslip-image').evaluate(
    (img) => img.complete && img.naturalWidth > 0,
  );
  assert.equal(loaded, true);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存图片' }).click();
  const download = await downloadPromise;
  const path = `${OUT}/payslip.png`;
  await download.saveAs(path);
  const info = await stat(path);
  assert.ok(info.size > 30_000, '工资条图片应有足够内容');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
});

await step('提醒设置与日历文件', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('switch', { name: '每日记工提醒' }).click();
  await page.waitForTimeout(300);
  await page.locator('.time-input').fill('20:30');
  await page.waitForTimeout(300);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('.settings-row').filter({ hasText: '添加到系统日历' }).click();
  const download = await downloadPromise;
  const path = `${OUT}/reminder.ics`;
  await download.saveAs(path);
  const ics = await readFile(path, 'utf8');
  assert.ok(ics.includes('T203000'));
  assert.ok(ics.includes('RRULE:FREQ=DAILY'));
});

await step('深色模式与持久化', async () => {
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    'dark',
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    'dark',
  );
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-group').filter({ hasText: '提醒' }).waitFor();
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await context.close();
await browser.close();
