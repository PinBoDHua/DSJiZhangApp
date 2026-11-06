import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const OUT = 'shots/android-v080';
await mkdir(OUT, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

await page.locator('.home-page').waitFor();
await page.locator('.fab').click();
await page.waitForTimeout(700);
await page.locator('.entry-sheet').waitFor();
const before = await page.evaluate(() => ({
  viewport: window.innerHeight,
  visual: Math.round(window.visualViewport?.height ?? 0),
  sheetTop: Math.round(document.querySelector('.entry-sheet').getBoundingClientRect().top),
  sheetBottom: Math.round(document.querySelector('.entry-sheet').getBoundingClientRect().bottom),
  saveVisible: Boolean(document.querySelector('.entry-save')),
}));
console.log('sheet:', JSON.stringify(before));
assert.ok(before.sheetBottom <= before.viewport + 1, '抽屉底部超出视口');
assert.ok(before.saveVisible, '保存按钮不可见');
await page.screenshot({ path: `${OUT}/09-entry-sheet.png` });

// 聚焦工时输入，观察软键盘弹出后可视视口是否收缩
const hours = page.locator('.entry-sheet .field').filter({ hasText: '工时（选填）' }).locator('input');
if (await hours.count()) {
  await hours.first().click();
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => ({
    viewport: window.innerHeight,
    visual: Math.round(window.visualViewport?.height ?? 0),
    saveBottom: Math.round(document.querySelector('.entry-save').getBoundingClientRect().bottom),
    visualHeight: Math.round(window.visualViewport?.height ?? 0),
  }));
  console.log('keyboard:', JSON.stringify(after));
  await page.screenshot({ path: `${OUT}/10-entry-keyboard.png` });
}

// 不保存，关闭并放弃
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(400);
const dialog = page.getByRole('alertdialog');
if (await dialog.count()) {
  await dialog.getByRole('button', { name: '放弃' }).click();
}
await page.waitForTimeout(400);
assert.equal(await page.locator('.entry-sheet').count(), 0, '抽屉没有关闭');
const home = await page.locator('.home-page').count();
console.log('back home:', home);
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await browser.close();
