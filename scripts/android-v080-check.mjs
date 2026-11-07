import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;

const OUT = 'shots/android-v080';
await mkdir(OUT, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? (await context.waitForEvent('page'));
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

const info = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  width: window.innerWidth,
  height: window.innerHeight,
  dpr: window.devicePixelRatio,
  hasPrivacyGate: Boolean(document.querySelector('.privacy-gate')),
  hasOnboarding: Boolean(document.querySelector('.onboarding')),
  home: Boolean(document.querySelector('.home-page')),
}));
console.log('webview:', JSON.stringify(info));

if (await page.locator('.privacy-gate').count()) {
  await page.getByRole('button', { name: '同意并继续' }).click();
  await page.waitForTimeout(700);
}
assert.equal(await page.locator('.onboarding').count(), 0, '真机账本不应处于引导页');

const localData = await page.evaluate(() => {
  const key = Object.keys(localStorage).find((item) => item.startsWith('xinshi.state.v'));
  if (!key) return null;
  const state = JSON.parse(localStorage.getItem(key));
  const notes = state.entries.map((entry) => entry.note).filter(Boolean);
  const dates = state.entries.map((entry) => entry.date).sort();
  return {
    schema: state.version,
    entries: state.entries.length,
    jobs: state.jobs.map((job) => job.name),
    firstNote: notes[0] ?? '',
    lastDate: dates[dates.length - 1] ?? '',
    noteSample: notes[notes.length - 1]?.slice(0, 12) ?? '',
    theme: state.settings.theme,
  };
});
console.log('ledger:', JSON.stringify({ ...localData, noteSample: undefined }));

await step('真机首页与安全区', async () => {
  await page.locator('.home-page').waitFor();
  const layout = await page.evaluate(() => {
    const main = document.querySelector('.app-main');
    const nav = document.querySelector('.bottom-nav');
    return {
      mainTop: main ? Math.round(main.getBoundingClientRect().top) : null,
      navBottom: nav ? Math.round(window.innerHeight - nav.getBoundingClientRect().bottom) : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  console.log('layout:', JSON.stringify(layout));
  assert.equal(layout.overflow, 0);
  assert.ok(layout.mainTop >= 40, `主区顶部 ${layout.mainTop} 被状态栏压住`);
  assert.ok(layout.navBottom >= 15, `底栏距底 ${layout.navBottom} 太小`);
  await page.screenshot({ path: `${OUT}/01-home.png` });
});

await step('记录页与搜索', async () => {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(600);
  const heading = page.locator('.page-heading h1');
  assert.equal(await heading.innerText(), '工记明细');
  const box = await heading.boundingBox();
  assert.ok(box && box.height < 50, `标题高度 ${box?.height}`);
  await page.screenshot({ path: `${OUT}/02-records.png` });
  await page.getByRole('button', { name: '搜索工记' }).click();
  await page.waitForTimeout(700);
  const term = localData?.jobs[0] ?? '2026';
  await page.locator('.search-input').fill(term);
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.entry-row').count()) >= 1, `搜索“${term}”没有结果`);
  await page.screenshot({ path: `${OUT}/03-search.png` });
  await page.getByRole('button', { name: '清空搜索' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(500);
});

await step('年度统计', async () => {
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '本年', exact: true }).click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.bar-col').count(), 12);
  assert.ok((await page.locator('.stats-hero').innerText()).includes('本年收入'));
  await page.screenshot({ path: `${OUT}/04-stats-year.png` });
  await page.getByRole('button', { name: '本周', exact: true }).click();
  await page.waitForTimeout(300);
});

await step(`关于页版本 ${APP_VERSION}`, async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.profile-footer').innerText()).includes(`v${APP_VERSION}`));
  await page.getByRole('button', { name: /关于薪时/ }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.about-version').innerText(), `v${APP_VERSION}`);
  await page.screenshot({ path: `${OUT}/05-about.png` });
  await page.getByRole('button', { name: '知道了' }).click();
  await page.waitForTimeout(300);
});

await step('真机导出备份写下载目录', async () => {
  await page.getByRole('button', { name: /数据与安全/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/06-data-safety.png` });
  await page.getByRole('button', { name: /立即导出备份/ }).click();
  await page.waitForTimeout(1800);
  const toast = await page.locator('.toast').innerText();
  console.log('backup toast:', toast);
  assert.ok(toast.includes('备份'), toast);
  await page.screenshot({ path: `${OUT}/07-backup.png` });
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(500);
});

await step('深色模式回到首页', async () => {
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/08-home-dark.png` });
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(400);
  const restoreLabel =
    localData?.theme === 'dark' ? '深色' : localData?.theme === 'light' ? '浅色' : '跟随系统';
  await page.getByRole('button', { name: restoreLabel, exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(400);
});

const perf = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  return {
    domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    load: nav ? Math.round(nav.loadEventEnd) : null,
    heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576),
  };
});
console.log('perf:', JSON.stringify(perf));
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await browser.close();
