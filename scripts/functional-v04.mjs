import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v04';
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

const compact = (value) => value.replace(/\s+/g, '');

await step('固定月薪岗位显示班次与月休设置', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(500);
  const demoStats = compact(await page.locator('.hero-stats').innerText());
  assert.ok(demoStats.includes('12h'), demoStats);
  assert.ok(demoStats.includes('2天'), demoStats);
  assert.ok(demoStats.includes('0h'), demoStats);
  assert.ok((await page.locator('.hero-caption').innerText()).includes('休 2/5 天'));

  // 同一天多份工作的合计工时要合理，超过 24h 直接拦截。
  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(300);
  await page.locator('.entry-sheet .job-choice').filter({ hasText: '城南工地' }).click();
  await page.waitForTimeout(200);
  const siteHours = page
    .locator('.entry-sheet .field')
    .filter({ hasText: '工时（选填）' })
    .locator('input');
  await siteHours.fill('20');
  await page.locator('.entry-save').click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.form-error').innerText()).includes('超过 24 小时'));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
  await page.waitForTimeout(300);
  await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(300);
  const preview = compact(await page.locator('.rule-preview').innerText());
  assert.ok(preview.includes('固定月薪'), preview);
  assert.ok(preview.includes('月休5天'), preview);
  assert.ok(preview.includes('默认09:00–17:00'), preview);
  assert.ok(preview.includes('午休120分'), preview);
  assert.ok(preview.includes('在岗6h'), preview);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(400);
});

await step('新建工记自动带入 6h + 午休 2h 班次', async () => {
  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(300);
  await page.locator('.entry-sheet .job-choice').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(300);
  const shift = compact(await page.locator('.attendance-shift').innerText());
  assert.ok(shift.includes('09:00–17:00'), shift);
  assert.ok(shift.includes('午休120分'), shift);
  assert.ok(shift.includes('在岗6h'), shift);
  const hoursInput = page
    .locator('.entry-sheet .field')
    .filter({ hasText: '工时（选填）' })
    .locator('input');
  assert.equal(await hoursInput.inputValue(), '6');
  assert.ok((await page.locator('.entry-preview').innerText()).includes('金额仅作参考'));
  await page.locator('.entry-save').click();
  await page.waitForTimeout(700);
});

await step('标休息并显示月休额度', async () => {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '记休息' }).click();
  await page.waitForTimeout(300);
  const quota = await page.locator('.rest-quota').innerText();
  assert.ok(quota.includes('本月已休 2 / 5 天'), quota);
  await page.getByLabel('休息日期', { exact: true }).fill('2026-11-10');
  await page.waitForTimeout(200);
  await page.locator('.sheet-footer .btn--primary').filter({ hasText: '标为休息' }).click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator('.toast').innerText()).includes('休息'));
  await page.getByRole('button', { name: '切换到日历视图' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.cal-rest-flag').count(), 3);
});

await step('固定月薪结算为 3500，不按出勤折算', async () => {
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settle-card').filter({ hasText: '老宅装修' }).first().click();
  await page.waitForTimeout(400);
  const stats = compact(await page.locator('.slip-stats').innerText());
  assert.ok(stats.includes('休息3天'), stats);
  const amount = compact(await page.locator('.amount-list').first().innerText());
  assert.ok(amount.includes('固定月薪'), amount);
  assert.ok(amount.includes('¥3,500.00'), amount);
  await page.locator('.settle-footer .btn--primary').click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(700);
  const record = compact(await page.locator('.subpage').innerText());
  assert.ok(record.includes('固定月薪'), record.slice(0, 180));
  assert.ok(record.includes('休息3天'), record.slice(0, 220));
});

await step('普通月薪仍按出勤折算', async () => {
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  // 新建一个月薪岗位，默认 prorated，验证旧算法没被固定月薪改坏。
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.settings-row').filter({ hasText: '工作管理' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '新建工作', exact: true }).last().click();
  await page.waitForTimeout(300);
  await page.getByPlaceholder('例如：城南工地 / 顺丰分拣').fill('折算月薪');
  await page.getByRole('button', { name: '月薪', exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('.money-input input[type=number]').fill('4400');
  await page.waitForTimeout(200);
  await page.locator('.job-editor-footer .btn--primary').click();
  await page.waitForTimeout(600);
  const list = compact(await page.locator('.subpage').innerText());
  assert.ok(list.includes('折算月薪'));
  assert.ok(list.includes('¥4400/月'), list.slice(0, 300));
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
