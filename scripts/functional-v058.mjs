import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v058';
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
await page.waitForTimeout(500);
await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
  state.jobs.find((job) => job.name === '老宅装修').workWeekdays = [1, 2, 3, 4, 5, 6];
  localStorage.setItem('xinshi.state.v7', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.getByRole('button', { name: '批量补记' }).click();
await page.waitForTimeout(500);
await page.getByLabel('补记开始日期').fill('2026-11-10');
await page.getByLabel('补记结束日期').fill('2026-11-15');
await page.waitForTimeout(300);
await page.getByRole('button', { name: '清空' }).click();
await page.getByRole('button', { name: '全选' }).click();
await page.waitForTimeout(200);

await step('批量扣款 + 逐天微调生成正确金额', async () => {
  await page.getByLabel('批量工时').fill('7');
  await page.getByLabel('批量奖金').fill('20');
  await page.getByLabel('批量扣款').fill('5');
  await page.getByLabel('统一备注').fill('夜班补记');
  await page.locator('.batch-overrides summary').click();
  await page.getByLabel('2026-11-10 工时').fill('9');
  await page.getByLabel('2026-11-10 奖金').fill('30');
  await page.getByLabel('2026-11-10 扣款').fill('1');
  await page.getByRole('button', { name: '保存模板' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '补记 5 天' }).click();
  await page.waitForTimeout(700);
  const entries = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.state.v7')).entries.filter(
      (entry) => entry.note === '夜班补记',
    ),
  );
  assert.equal(entries.length, 5);
  const first = entries.find((entry) => entry.date === '2026-11-10');
  assert.deepEqual(
    { hours: first.hours, bonus: first.bonus, deduction: first.deduction },
    { hours: 9, bonus: 30, deduction: 1 },
  );
  const others = entries.filter((entry) => entry.date !== '2026-11-10');
  assert.ok(
    others.every(
      (entry) =>
        entry.hours === 7 && entry.bonus === 20 && entry.deduction === 5,
    ),
  );
});

await step('常用模板保存后可以再次套用', async () => {
  const templates = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.batchTemplates')),
  );
  assert.equal(templates.length, 1);
  await page.getByRole('button', { name: '批量补记' }).click();
  await page.waitForTimeout(400);
  await page.getByLabel('常用模板').selectOption({ label: '夜班补记 · 7h' });
  await page.waitForTimeout(250);
  assert.equal(await page.getByLabel('批量工时').inputValue(), '7');
  assert.equal(await page.getByLabel('批量奖金').inputValue(), '20');
  assert.equal(await page.getByLabel('批量扣款').inputValue(), '5');
  assert.equal(await page.getByLabel('统一备注').inputValue(), '夜班补记');
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
