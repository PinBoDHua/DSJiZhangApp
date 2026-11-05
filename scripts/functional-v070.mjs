import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v070';
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

async function entryCount() {
  return page.evaluate(() => {
    const raw = localStorage.getItem('xinshi.state.v7');
    return raw ? JSON.parse(raw).entries.length : 0;
  });
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(1900);

await step('首页是新版轻量视觉，底部导航悬浮', async () => {
  await page.locator('.hero-progress').waitFor();
  assert.ok((await page.locator('.hero-progress span').count()) === 1);
  const navBox = await page.locator('.bottom-nav-inner').boundingBox();
  assert.ok(navBox && navBox.width < 540, '底部导航不是悬浮胶囊');
  await page.screenshot({ path: `${OUT}/01-home.png` });
});

await step('小时工可直接点常用时长', async () => {
  const before = await entryCount();
  await page.getByRole('button', { name: /记上|再记/ }).click();
  await page.waitForTimeout(500);
  await page.locator('.job-choice').filter({ hasText: '顺丰' }).click();
  await page.waitForTimeout(200);
  const presets = page.locator('.duration-presets button');
  assert.equal(await presets.count(), 5);
  await page.locator('.time-box input').first().fill('08:00');
  await presets.filter({ hasText: '8h' }).click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.time-box input').nth(1).inputValue(), '16:30');
  await page.screenshot({ path: `${OUT}/02-entry-presets.png` });
  await page.locator('.entry-save').click();
  await page.waitForTimeout(700);
  assert.equal(await entryCount(), before + 1);
});

await step('首页可以照上次班次快速记一笔', async () => {  await page.evaluate(() => {
    const key = 'xinshi.state.v7';
    const state = JSON.parse(localStorage.getItem(key));
    const today = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const todayISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    state.entries = state.entries.filter((entry) => entry.date !== todayISO);
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const link = page.getByRole('button', { name: '照上次班次' });
  await link.waitFor();
  await page.screenshot({ path: `${OUT}/03-home-repeat.png` });
  const before = await entryCount();
  await link.click();
  await page.waitForTimeout(500);
  assert.ok(await page.locator('.entry-save').isVisible());
  await page.locator('.entry-save').click();
  await page.waitForTimeout(700);
  assert.equal(await entryCount(), before + 1);
});

await step('统计新增 12 周工时热力图', async () => {
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator('.heat-day').count()) >= 84);
  assert.match(await page.locator('.heat-card').innerText(), /最近 12 周/);
  await page.screenshot({ path: `${OUT}/04-stats-heatmap.png` });
});

await step('懒加载页面切换正常且没有控制台错误', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /数据与安全/ }).click();
  await page.waitForTimeout(700);
  await page.locator('.subpage-title h1').filter({ hasText: '数据与安全' }).waitFor();
  await page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(errors.length, 0);
});

await step('320px 首页与统计无横向溢出', async () => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(300);
  let overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.equal(overflow, false);
  await page.screenshot({ path: `${OUT}/05-home-320.png` });
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(500);
  overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.equal(overflow, false);
  await page.screenshot({ path: `${OUT}/06-stats-320.png` });
});

const timing = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  return nav ? Math.round(nav.domContentLoadedEventEnd) : null;
});
console.log('domContentLoaded ms:', timing);
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
