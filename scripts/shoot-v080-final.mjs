import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.8';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function newPage(viewport) {
  const context = await browser.newContext({
    viewport,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => localStorage.setItem('xinshi.privacyConsent', '2026-11-05'));
  const page = await context.newPage();
  return { context, page };
}

// 引导页 + 手机主流程
{
  const { context, page } = await newPage({ width: 390, height: 844 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/01-onboarding.png` });
  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(3300);
  await page.screenshot({ path: `${OUT}/02-home.png` });

  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/03-records.png` });

  await page.getByRole('button', { name: '搜索工记' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/04-search-guide.png` });
  await page.locator('.search-input').fill('水电');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/05-search-result.png` });
  await page.getByRole('button', { name: '清空搜索' }).click();
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /记上|再记/ }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-entry.png` });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
  if (await page.getByRole('alertdialog').count()) {
    await page.getByRole('button', { name: '放弃' }).click();
  }
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '本年', exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/07-stats-year.png` });

  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /关于薪时/ }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/08-about.png` });
  await page.getByRole('button', { name: '知道了' }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/09-home-dark.png` });
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '搜索工记' }).click();
  await page.waitForTimeout(400);
  await page.locator('.search-input').fill('11月');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/10-search-dark.png` });
  await context.close();
}

// 桌面
{
  const { context, page } = await newPage({ width: 1280, height: 800 });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(3300);
  await page.screenshot({ path: `${OUT}/11-desktop-home.png` });
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '本年', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/12-desktop-stats-year.png` });
  await context.close();
}

await browser.close();
console.log('shots/v0.8 done');
