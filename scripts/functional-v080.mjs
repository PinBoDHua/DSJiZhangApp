import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v080';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
  acceptDownloads: true,
});
await context.addInitScript(() =>
  localStorage.setItem('xinshi.privacyConsent', '2026-11-05'),
);
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
const parseMoney = (text) => Number((text.match(/[\d,]+\.\d{2}/)?.[0] ?? '0').replace(/,/g, ''));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(1900);

await step('记录页主标题不换行，动作按钮都有名称', async () => {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(600);
  const heading = page.locator('.page-heading h1');
  assert.equal(await heading.innerText(), '工记');
  const box = await heading.boundingBox();
  assert.ok(box && box.height < 40, `标题高度 ${box?.height}`);
  for (const name of ['搜索工记', '切换到日历视图', '月度考勤', '记休息']) {
    assert.ok(await page.getByRole('button', { name }).count(), `缺少按钮 ${name}`);
  }
  await page.screenshot({ path: `${OUT}/01-records-header.png` });
});

await step('搜索入口、指南与备注命中', async () => {
  await page.getByRole('button', { name: '搜索工记' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.subpage-title h1').innerText(), '搜索工记');
  assert.ok((await page.locator('.search-guide').innerText()).includes('试试点什么'));
  await page.locator('.search-input').fill('水电');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('.entry-row').count(), 1);
  assert.ok((await page.locator('.entry-row-note').innerText()).includes('水电验收'));
  assert.ok((await page.locator('.search-summary').innerText()).includes('1'));
  await page.screenshot({ path: `${OUT}/02-search-note.png` });
});

await step('搜索支持日期、金额与多关键词', async () => {
  const input = page.locator('.search-input');
  const count = async (value) => {
    await input.fill(value);
    await page.waitForTimeout(300);
    return page.locator('.entry-row').count();
  };
  assert.ok((await count('11-6')) >= 1, '未补齐的日期 11-6 没有命中');
  assert.ok((await count('¥159')) >= 1, '金额 ¥159 没有命中');
  assert.equal(await count('顺丰 夜班'), 1);
  assert.equal(await count('顺丰 搬水泥'), 0);
  assert.ok((await page.locator('.empty-card').innerText()).includes('没有找到这笔工记'));
  await page.screenshot({ path: `${OUT}/03-search-none.png` });
});

await step('搜索可按岗位筛选并打开工记详情', async () => {
  await page.locator('.search-input').fill('顺丰');
  await page.waitForTimeout(300);
  await page
    .locator('.search-page .filter-row, .subpage .filter-row')
    .getByRole('button', { name: /顺丰夜班分拣/ })
    .click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.entry-row').count(), 1);
  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.sheet').innerText()).includes('顺丰夜班分拣'));
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.search-input').inputValue(), '顺丰');
});

await step('清空搜索回到指南，返回记录页', async () => {
  await page.getByRole('button', { name: '清空搜索' }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.search-guide').innerText()).includes('试试点什么'));
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.page-heading h1').innerText(), '工记');
});

await step('统计新增本年：12 个月与年度合计一致', async () => {
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '本年', exact: true }).click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator('.month-switch-label').innerText()).includes('2026年'));
  assert.ok((await page.locator('.stats-hero').innerText()).includes('本年收入'));
  assert.equal(await page.locator('.bar-col').count(), 12);
  const hero = parseMoney(
    (await page.locator('.stats-amount').getAttribute('aria-label')) ?? '',
  );
  const bars = await page.locator('.bar-col').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  );
  const barSum = bars.reduce((sum, label) => sum + parseMoney(label), 0);
  assert.ok(Math.abs(hero - barSum) < 0.011, `年度合计 ${hero} ≠ 柱状图之和 ${barSum}`);
  await page.screenshot({ path: `${OUT}/04-stats-year.png`, fullPage: true });
});

await step('可以翻到上一年并看到年度空状态', async () => {
  await page.getByRole('button', { name: '上一年' }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.month-switch-label').innerText()).includes('2025年'));
  assert.ok((await page.locator('.empty-card').innerText()).includes('2025 年还没有工记'));
  await page.screenshot({ path: `${OUT}/05-stats-year-empty.png` });
  await page.getByRole('button', { name: '下一年' }).click();
  await page.waitForTimeout(500);
});

await step('320px 下年度统计与搜索页无横向溢出', async () => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(400);
  let overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.equal(overflow, false, '年度统计 320px 横向溢出');
  await page.screenshot({ path: `${OUT}/06-stats-year-320.png` });
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '搜索工记' }).click();
  await page.waitForTimeout(400);
  await page.locator('.search-input').fill('11');
  await page.waitForTimeout(300);
  overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.equal(overflow, false, '搜索页 320px 横向溢出');
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
});

await step('关于页显示 0.8.0，版本号只有一处来源', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.profile-footer').innerText()).includes('v0.8.0'));
  await page.getByRole('button', { name: /关于薪时/ }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.about-version').innerText(), 'v0.8.0');
  await page.screenshot({ path: `${OUT}/07-about.png` });
  await page.getByRole('button', { name: '知道了' }).click();
  await page.waitForTimeout(300);
});

await step('深色模式下搜索与年度统计可读', async () => {
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '搜索工记' }).click();
  await page.waitForTimeout(400);
  await page.locator('.search-input').fill('水电');
  await page.waitForTimeout(300);
  const summaryBg = await page.locator('.search-summary').evaluate((el) => getComputedStyle(el).backgroundImage);
  assert.ok(summaryBg.includes('linear-gradient'), '搜索摘要没有继承深色变量');
  await page.screenshot({ path: `${OUT}/08-search-dark.png` });
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '本年', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/09-stats-year-dark.png` });
});

await step('新装首次打开显示 0.8.0 引导徽标', async () => {
  const fresh = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    serviceWorkers: 'block',
  });
  await fresh.addInitScript(() =>
    localStorage.setItem('xinshi.privacyConsent', '2026-11-05'),
  );
  const freshPage = await fresh.newPage();
  await freshPage.goto(BASE, { waitUntil: 'networkidle' });
  await freshPage.waitForTimeout(500);
  assert.ok((await freshPage.locator('.onboarding-badge').innerText()).includes('v0.8.0'));
  await freshPage.screenshot({ path: `${OUT}/10-onboarding.png` });
  await fresh.close();
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
