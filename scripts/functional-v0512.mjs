import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v0512';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
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

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '月度考勤' }).click();
await page.waitForTimeout(500);

await step('月度考勤显示多岗位 × 日期总表', async () => {
  const text = await page.locator('.attendance-table').innerText();
  assert.ok(text.includes('城南工地'));
  assert.ok(text.includes('顺丰夜班分拣'));
  assert.ok(text.includes('老宅装修'));
  assert.ok(text.includes('礼盒包装'));
  const summary = await page.locator('.attendance-summary').innerText();
  assert.ok(summary.includes('2 天'), summary);
  assert.ok(summary.includes('12h'), summary);
  await page.screenshot({ path: `${OUT}/01-attendance-grid.png` });
});

await step('半天休息进入考勤和本地数据', async () => {
  await page.getByRole('button', { name: /11月10日 老宅装修 未记/ }).click();
  await page.waitForTimeout(300);
  const sheet = page.locator('.attendance-day-sheet');
  assert.ok(await sheet.isVisible());
  await sheet.getByRole('button', { name: '半天', exact: true }).click();
  await sheet.getByRole('button', { name: '标为休息', exact: true }).click();
  await page.waitForTimeout(500);
  const rest = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
    const job = state.jobs.find((item) => item.name === '老宅装修');
    return state.restDays.find(
      (item) => item.jobId === job.id && item.date === '2026-11-10',
    );
  });
  assert.equal(rest.days, 0.5);
  assert.ok((await page.locator('.attendance-summary').innerText()).includes('2.5 天'));
  assert.ok(
    await page.getByRole('button', { name: /11月10日 老宅装修 休息 0.5 天/ }).isVisible(),
  );
  await page.screenshot({ path: `${OUT}/02-half-rest.png` });
});

await step('考勤格子里可以补记工，休息自动移除', async () => {
  await page.getByRole('button', { name: /11月10日 老宅装修 休息 0.5 天/ }).click();
  await page.waitForTimeout(300);
  await page
    .locator('.attendance-day-sheet')
    .getByRole('button', { name: '补记工', exact: true })
    .click();
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator('.entry-sheet input[type=date]').inputValue(),
    '2026-11-10',
  );
  await page.locator('.entry-save').click();
  await page.waitForTimeout(700);
  assert.ok(
    await page.getByRole('button', { name: /11月10日 老宅装修 已记工 6 小时/ }).isVisible(),
  );
  const restCount = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
    const job = state.jobs.find((item) => item.name === '老宅装修');
    return state.restDays.filter(
      (item) => item.jobId === job.id && item.date === '2026-11-10',
    ).length;
  });
  assert.equal(restCount, 0);
  assert.ok((await page.locator('.attendance-summary').innerText()).includes('3 天'));
});

await step('月结页可以从日期弹层补记并结算', async () => {
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /核对结算/ }).last().click();
  await page.waitForTimeout(500);
  await page.locator('.rest-month-card').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: /11月12日未记/ }).click();
  await page.waitForTimeout(300);
  await page
    .locator('.attendance-day-sheet')
    .getByRole('button', { name: '补记工', exact: true })
    .click();
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator('.entry-sheet input[type=date]').inputValue(),
    '2026-11-12',
  );
  await page.locator('.entry-save').click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator('.slip-stats').innerText()).includes('4 天'));
  await page.screenshot({ path: `${OUT}/03-settlement-add-entry.png` });
  await page.locator('.settle-footer').getByRole('button', { name: '确认结算' }).click();
  await page.waitForTimeout(300);
  await page
    .getByRole('alertdialog', { name: '确认结算这一期？' })
    .getByRole('button', { name: '确认结算' })
    .click();
  await page.waitForTimeout(800);
  const settlement = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.state.v7')).settlements[0],
  );
  assert.equal(settlement.days, 4);
});

await step('已结算格子在考勤里锁定', async () => {
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '月度考勤' }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.attendance-cell.is-locked').count()) >= 1);
  await page.getByRole('button', { name: /11月12日 老宅装修 已记工 6 小时/ }).click();
  await page.waitForTimeout(300);
  const sheet = await page.locator('.attendance-day-sheet').innerText();
  assert.ok(sheet.includes('已经结算'));
  assert.ok(!sheet.includes('补记工'));
  await page.screenshot({ path: `${OUT}/04-locked-cell.png` });
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
