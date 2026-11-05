import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v070-qa';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
});
await context.addInitScript(() => localStorage.setItem('xinshi.privacyConsent', '2026-11-05'));
const page = await context.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(String(err)));
const timing = { start: Date.now() };

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/01-onboarding.png` });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(1800);
console.log('load ms:', Date.now() - timing.start);
await page.screenshot({ path: `${OUT}/02-home.png` });
console.log('home text:', (await page.locator('.home-page').innerText()).slice(0, 160).replace(/\n/g, ' | '));

await page.getByRole('button', { name: /记上|再记/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/03-entry.png` });
console.log('entry presets:', await page.locator('.duration-presets button').count());

await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: '统计', exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/04-stats.png` });
console.log('heat cells:', await page.locator('.heat-day').count());

await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/05-profile.png` });

const overflow390 = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
);
console.log('overflow 390:', overflow390);
assert.equal(overflow390, false);

await page.setViewportSize({ width: 320, height: 720 });
await page.waitForTimeout(300);
const overflow320 = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
);
console.log('overflow 320:', overflow320);
await page.screenshot({ path: `${OUT}/06-profile-320.png` });
assert.equal(overflow320, false);

await page.getByRole('button', { name: '首页', exact: true }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/07-home-320.png` });

console.log('errors:', errors);
await browser.close();
