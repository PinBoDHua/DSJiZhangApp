import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v059';
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
  state.jobs.find((job) => job.name === '城南工地').workWeekdays = [0, 1, 2, 3, 4];
  localStorage.setItem('xinshi.state.v7', JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('.plan-week-tabs button').filter({ hasText: '老宅装修' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '批量补记' }).click();
await page.waitForTimeout(500);
await page.getByLabel('补记开始日期').fill('2026-11-10');
await page.getByLabel('补记结束日期').fill('2026-11-15');
await page.waitForTimeout(300);
await page.getByRole('button', { name: '清空' }).click();
await page.getByRole('button', { name: '全选' }).click();

await step('逐天备注可以覆盖统一备注', async () => {
  await page.getByLabel('批量工时').fill('7');
  await page.getByLabel('批量奖金').fill('20');
  await page.getByLabel('批量扣款').fill('5');
  await page.getByLabel('统一备注').fill('夜班补记');
  await page.getByRole('button', { name: '保存模板' }).click();
  await page.waitForTimeout(300);
  await page.locator('.batch-overrides summary').click();
  await page.getByLabel('2026-11-10 备注').fill('加班到十点');
  await page.getByRole('button', { name: '补记 5 天' }).click();
  await page.waitForTimeout(700);
  const entries = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.state.v7')).entries.filter(
      (entry) =>
        entry.date >= '2026-11-10' && entry.date <= '2026-11-14',
    ),
  );
  assert.equal(entries.length, 5);
  assert.equal(
    entries.find((entry) => entry.date === '2026-11-10').note,
    '加班到十点',
  );
  assert.ok(
    entries
      .filter((entry) => entry.date !== '2026-11-10')
      .every((entry) => entry.note === '夜班补记'),
  );
  const templates = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.batchTemplates')),
  );
  assert.ok(templates[0].jobId, '模板应绑定岗位');
});

await step('模板按岗位展示，并可导入 JSON', async () => {
  await page.locator('.plan-week-tabs button').filter({ hasText: '城南工地' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '批量补记' }).click();
  await page.waitForTimeout(400);
  const options = await page.getByLabel('常用模板').locator('option').allInnerTexts();
  assert.ok(!options.some((text) => text.includes('夜班补记')), options.join(','));
  const imported = {
    app: 'xinshi',
    kind: 'batch-templates',
    version: 1,
    templates: [
      {
        id: 'imported-1',
        name: '导入模板',
        hours: 6,
        bonus: 10,
        deduction: 1,
        note: '导入备注',
      },
    ],
  };
  await page.locator('.batch-plan-sheet input[type=file]').setInputFiles({
    name: 'templates.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.toast').innerText()).includes('已导入 1 个模板'));
  await page.getByLabel('常用模板').selectOption({ label: '导入模板 · 6h' });
  await page.waitForTimeout(250);
  assert.equal(await page.getByLabel('批量工时').inputValue(), '6');
  assert.equal(await page.getByLabel('批量奖金').inputValue(), '10');
  assert.equal(await page.getByLabel('批量扣款').inputValue(), '1');
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
