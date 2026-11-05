import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.7';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function newPage(viewport = { width: 390, height: 844 }, theme = 'light') {
  const context = await browser.newContext({
    viewport,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    serviceWorkers: 'block',
  });
  await context.addInitScript(
    ({ theme }) => {
      localStorage.setItem('xinshi.privacyConsent', '2026-11-05');
      localStorage.setItem('xinshi.theme', theme);
    },
    { theme },
  );
  const page = await context.newPage();
  return { context, page };
}

const phone = await newPage();
await phone.page.goto(BASE, { waitUntil: 'networkidle' });
await phone.page.waitForTimeout(500);
await phone.page.screenshot({ path: `${OUT}/01-onboarding.png` });

await phone.page.getByRole('button', { name: /先看看示例数据/ }).click();
await phone.page.waitForTimeout(3300);
await phone.page.screenshot({ path: `${OUT}/02-home.png` });

await phone.page.getByRole('button', { name: /记上|再记/ }).click();
await phone.page.waitForTimeout(500);
await phone.page.locator('.job-choice').filter({ hasText: '顺丰' }).click();
await phone.page.waitForTimeout(200);
await phone.page.locator('.time-box input').first().fill('08:00');
await phone.page.locator('.duration-presets button').filter({ hasText: '8h' }).click();
await phone.page.waitForTimeout(400);
await phone.page.screenshot({ path: `${OUT}/03-entry.png` });
await phone.page.getByRole('button', { name: '关闭', exact: true }).click();
await phone.page.waitForTimeout(400);

await phone.page.evaluate(() => {
  const key = 'xinshi.state.v7';
  const state = JSON.parse(localStorage.getItem(key));
  const today = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const todayISO = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  state.entries = state.entries.filter((entry) => entry.date !== todayISO);
  localStorage.setItem(key, JSON.stringify(state));
});
await phone.page.reload({ waitUntil: 'networkidle' });
await phone.page.waitForTimeout(3000);
await phone.page.screenshot({ path: `${OUT}/04-home-repeat.png` });

await phone.page.getByRole('button', { name: '统计', exact: true }).click();
await phone.page.waitForTimeout(900);
await phone.page.screenshot({ path: `${OUT}/05-stats.png` });

await phone.page.getByRole('button', { name: '首页', exact: true }).click();
await phone.page.waitForTimeout(400);
await phone.page.evaluate(() => {
  localStorage.setItem('xinshi.theme', 'dark');
  const raw = localStorage.getItem('xinshi.state.v7');
  if (!raw) return;
  const state = JSON.parse(raw);
  state.settings.theme = 'dark';
  localStorage.setItem('xinshi.state.v7', JSON.stringify(state));
});
await phone.page.reload({ waitUntil: 'networkidle' });
await phone.page.waitForTimeout(2600);
await phone.page.screenshot({ path: `${OUT}/06-home-dark.png` });
await phone.context.close();

const desktop = await newPage({ width: 1280, height: 900 });
await desktop.page.goto(BASE, { waitUntil: 'networkidle' });
await desktop.page.getByRole('button', { name: /先看看示例数据/ }).click();
await desktop.page.waitForTimeout(3300);
await desktop.page.screenshot({ path: `${OUT}/07-desktop-home.png` });
await desktop.context.close();

await browser.close();
console.log('v0.7 screenshots ready');
