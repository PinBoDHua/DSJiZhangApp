import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const OUT = 'shots/android-v070';
await mkdir(OUT, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? (await context.waitForEvent('page'));
await page.setViewportSize({ width: 390, height: 844 }).catch(() => undefined);
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(String(error)));

if (await page.locator('.privacy-gate').count()) {
  await page.getByRole('button', { name: '同意并继续' }).click();
  await page.waitForTimeout(800);
}
if (await page.locator('.onboarding').count()) {
  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(2600);
}

await page.screenshot({ path: `${OUT}/01-home.png` });
await page.getByRole('button', { name: /记上|再记/ }).click();
await page.waitForTimeout(500);
await page.locator('.job-choice').filter({ hasText: '顺丰' }).click();
await page.waitForTimeout(200);
await page.locator('.time-box input').first().fill('08:00');
await page.locator('.duration-presets button').filter({ hasText: '8h' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-entry.png` });
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(250);
if (await page.getByRole('alertdialog').count()) {
  await page.getByRole('button', { name: '放弃' }).click();
}
await page.waitForTimeout(400);
await page.getByRole('button', { name: '统计', exact: true }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/03-stats.png` });
await page.getByRole('button', { name: '首页', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-home-again.png` });

console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
