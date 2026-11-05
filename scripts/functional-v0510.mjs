import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v0510';
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

await step('工作设置可以切到随机休息并保存', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.getByRole('button', { name: /工作管理/ }).click();
  await page.locator('.job-manage-card').filter({ hasText: '老宅装修' }).click();
  await page.waitForTimeout(400);
  const restGroup = page.getByRole('group', { name: '休息规则' });
  await restGroup.scrollIntoViewIfNeeded();
  await restGroup.getByRole('button', { name: '随机休息' }).click();
  await page.waitForTimeout(200);
  assert.ok(
    (await page.getByText('不设固定月休额度').innerText()).includes('不设固定月休额度'),
  );
  await page.screenshot({ path: `${OUT}/01-flexible-rest-rule.png` });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
    const job = state.jobs.find((item) => item.name === '老宅装修');
    return {
      restPolicy: job.rule.restPolicy,
      restDaysPerMonth: job.rule.restDaysPerMonth,
      overRestDeduct: job.rule.overRestDeduct,
    };
  });
  assert.equal(saved.restPolicy, 'flexible');
  assert.equal(saved.restDaysPerMonth, 0);
  assert.equal(saved.overRestDeduct, false);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
});

let targetDate = '';

await step('月结页显示随机休息月历，可补标和取消', async () => {
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /核对结算/ }).last().click();
  await page.waitForTimeout(500);
  const board = page.locator('.rest-month-card');
  await board.scrollIntoViewIfNeeded();
  assert.ok((await board.innerText()).includes('随机休息'));
  assert.ok((await board.innerText()).includes('休息 2 天'));
  assert.ok(!(await board.innerText()).includes('额度 5 天'));

  const beforeDates = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
    const job = state.jobs.find((item) => item.name === '老宅装修');
    return state.restDays
      .filter((rest) => rest.jobId === job.id)
      .map((rest) => rest.date);
  });

  await page.locator('.rest-month-day.is-empty').first().click();
  await page.waitForTimeout(300);
  await page
    .locator('.attendance-day-sheet')
    .getByRole('button', { name: '标为休息', exact: true })
    .click();
  await page.waitForTimeout(400);
  targetDate = await page.evaluate((known) => {
    const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
    const job = state.jobs.find((item) => item.name === '老宅装修');
    return state.restDays
      .filter((rest) => rest.jobId === job.id && !known.includes(rest.date))
      .map((rest) => rest.date)[0] ?? '';
  }, beforeDates);
  assert.ok(targetDate, '应能找到刚补标的休息日期');
  assert.ok((await board.innerText()).includes('休息 3 天'));
  assert.ok((await page.locator('.toast').innerText()).includes('一天休息'));
  await page.screenshot({ path: `${OUT}/02-rest-marked.png` });

  await page.locator(`.rest-month-day[data-date="${targetDate}"]`).click();
  await page.waitForTimeout(300);
  const restSheet = page.locator('.attendance-day-sheet');
  assert.ok(await restSheet.isVisible());
  assert.ok((await restSheet.innerText()).includes('休息 1 天'));
  await restSheet.getByRole('button', { name: '取消这天的休息' }).click();
  await page.waitForTimeout(350);
  assert.ok((await board.innerText()).includes('休息 2 天'));

  await page.locator(`.rest-month-day[data-date="${targetDate}"]`).click();
  await page.waitForTimeout(300);
  await page
    .locator('.attendance-day-sheet')
    .getByRole('button', { name: '标为休息', exact: true })
    .click();
  await page.waitForTimeout(300);
  assert.ok((await board.innerText()).includes('休息 3 天'));
});

await step('补标的休息进入结算快照和结算单', async () => {
  await page.locator('.settle-footer').getByRole('button', { name: '确认结算' }).click();
  await page.waitForTimeout(250);
  await page
    .getByRole('alertdialog', { name: '确认结算这一期？' })
    .getByRole('button', { name: '确认结算' })
    .click();
  await page.waitForTimeout(700);
  const settlement = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
    return state.settlements[0];
  });
  assert.equal(settlement.restDays, 3);
  assert.ok(settlement.restDates.includes(targetDate));
  assert.ok(
    await page.getByRole('heading', { name: '本期休息', exact: true }).isVisible(),
  );
  assert.ok((await page.locator('.rest-date-list').innerText()).includes(
    `${Number(targetDate.slice(5, 7))}月${Number(targetDate.slice(8))}日`,
  ));
  await page.screenshot({ path: `${OUT}/03-settlement-rest-dates.png` });
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
