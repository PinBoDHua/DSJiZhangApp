import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
const OUT = 'test-results-android-v120';
await mkdir(OUT, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const pages = context.pages();
const page = pages.find((item) => item.url().startsWith('https://localhost')) ?? pages[0];
assert.ok(page, '没有找到薪时 WebView');
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
await page.locator('.home-page').waitFor({ timeout: 15000 });
assert.equal(await page.locator('.onboarding').count(), 0, '升级后不应回到引导页');

const before = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('xinshi.state.v7') || '{}');
  return {
    schema: state.version,
    entries: state.entries?.length ?? 0,
    jobs: state.jobs?.length ?? 0,
    settlements: state.settlements?.length ?? 0,
    rules: state.recurringRules?.length ?? 0,
    budget: state.settings?.budget ?? null,
    theme: state.settings?.theme,
  };
});
assert.equal(before.schema, 7);
console.log('BEFORE', JSON.stringify(before));

const layout = await page.evaluate(() => ({
  width: window.innerWidth,
  height: window.innerHeight,
  overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  mainTop: Math.round(document.querySelector('.app-main')?.getBoundingClientRect().top ?? 0),
  navBottom: Math.round(window.innerHeight - (document.querySelector('.bottom-nav')?.getBoundingClientRect().bottom ?? 0)),
}));
console.log('LAYOUT', JSON.stringify(layout));
await page.screenshot({ path: `${OUT}/01-home.png` });
assert.equal(layout.overflow, 0);
assert.ok(layout.mainTop >= 35, `主区顶部 ${layout.mainTop}px 小于预期安全区`);
assert.ok(layout.navBottom >= 15, `底栏距底 ${layout.navBottom}px 小于预期`);
console.log('PASS 首页、安全区与无横向溢出', JSON.stringify(layout));

await page.getByRole('button', { name: '统计', exact: true }).click();
await page.getByRole('button', { name: '本年', exact: true }).click();
await page.waitForTimeout(600);
if (before.entries > 0) {
  await page.locator('.category-card').waitFor();
  assert.ok(await page.locator('.category-card .distribution-row').count() > 0);
}
await page.screenshot({ path: `${OUT}/02-stats.png`, fullPage: true });
console.log('PASS 真机分类统计');

await page.getByRole('button', { name: '记录', exact: true }).click();
await page.getByRole('button', { name: '周期记工', exact: true }).click();
await page.locator('.subpage-title h1').waitFor();
assert.equal(await page.locator('.subpage-title h1').innerText(), '周期记工');
assert.ok((await page.locator('.recurring-summary').innerText()).includes('待补记'));
await page.screenshot({ path: `${OUT}/03-recurring.png`, fullPage: true });
await page.getByRole('button', { name: '返回', exact: true }).click();
console.log('PASS 周期记工入口与预览页');

await page.getByRole('button', { name: '我的', exact: true }).click();
assert.ok((await page.locator('.profile-footer').innerText()).includes(`v${APP_VERSION}`));
await page.getByRole('button', { name: /数据与安全/ }).click();
await page.getByRole('button', { name: /完整工记 CSV/ }).click();
await page.waitForTimeout(800);
const exportToast = await page.locator('.toast').innerText();
assert.ok(exportToast.includes('下载/Xinshi') || exportToast.includes('已保存'));
await page.screenshot({ path: `${OUT}/04-export.png`, fullPage: true });
console.log('PASS 原生完整 CSV 导出');

const pluginResult = await page.evaluate(async () => {
  const plugin = window.Capacitor?.Plugins?.SaveFile;
  if (!plugin) throw new Error('SaveFile 插件未注册');
  const options = {
    filename: 'v120-overwrite-test.json',
    mimeType: 'application/json',
    subdir: '测试',
  };
  await plugin.save({ ...options, data: btoa('{"version":1}') });
  const second = await plugin.save({ ...options, data: btoa('{"version":2}') });
  return second;
});
assert.ok(pluginResult.path.includes('v120-overwrite-test.json'));
console.log('PASS 原生同名文件第二次写入', JSON.stringify(pluginResult));

const after = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('xinshi.state.v7') || '{}');
  return {
    schema: state.version,
    entries: state.entries?.length ?? 0,
    jobs: state.jobs?.length ?? 0,
    settlements: state.settlements?.length ?? 0,
    rules: state.recurringRules?.length ?? 0,
    budget: state.settings?.budget ?? null,
    theme: state.settings?.theme,
  };
});
assert.deepEqual(after, before, '只读真机验收不应改变账本');
assert.deepEqual(errors, [], errors.join('\n'));
await writeFile(`${OUT}/result.json`, JSON.stringify({ before, after, layout, exportToast, pluginResult, errors }, null, 2));
await browser.close();
console.log(`ALL PASS Android v${APP_VERSION}；账本保持不变`);
