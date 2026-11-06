import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v080-dark';
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
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(1800);
await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '深色', exact: true }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/01-profile-dark.png` });
await page.getByRole('button', { name: '首页', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/02-home-dark.png` });
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '搜索工记' }).click();
await page.waitForTimeout(500);
await page.locator('.search-input').fill('水电');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/03-search-dark.png` });
await page.getByRole('button', { name: '返回' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '统计', exact: true }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: '本年', exact: true }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-stats-year-dark.png`, fullPage: true });
await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /关于薪时/ }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/05-about-dark.png` });

// 粗略对比度检查：正文文字与其最近不透明背景的亮度比
const contrast = await page.evaluate(() => {
  const parse = (color) => {
    const match = color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!match) return null;
    return { r: +match[1], g: +match[2], b: +match[3], a: match[4] === undefined ? 1 : +match[4] };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el) => {
    let node = el;
    while (node) {
      const style = getComputedStyle(node);
      const bg = parse(style.backgroundColor);
      if (bg && bg.a > 0.9) return bg;
      node = node.parentElement;
    }
    return { r: 244, g: 241, b: 232, a: 1 };
  };
  const issues = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || +style.opacity === 0) continue;
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const l1 = lum(fg);
    const l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < 3) {
      issues.push({
        text: text.slice(0, 24),
        cls: typeof el.className === 'string' ? el.className : '',
        ratio: Math.round(ratio * 100) / 100,
        color: style.color,
        bg: `rgb(${bg.r},${bg.g},${bg.b})`,
      });
    }
  }
  return issues.slice(0, 30);
});
console.log('low contrast nodes:', JSON.stringify(contrast, null, 2));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();
