import { chromium } from 'playwright-core';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [w, h] = (process.argv[2] || '407x904').split('x').map(Number);

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: 2,
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'block',
});
await context.addInitScript(() => localStorage.setItem('xinshi.privacyConsent', '2026-11-05'));
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(2200);

const probe = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const rows = [];
  const describe = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  };
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.right <= vw + 0.5) continue;
    const chain = [];
    let parent = el.parentElement;
    while (parent && parent !== document.documentElement) {
      const style = getComputedStyle(parent);
      chain.push(`${describe(parent)}[${style.overflowX}]`);
      parent = parent.parentElement;
    }
    rows.push({
      el: describe(el),
      left: +rect.left.toFixed(1),
      right: +rect.right.toFixed(1),
      width: +rect.width.toFixed(1),
      chain: chain.slice(0, 4).join(' < '),
    });
  }
  return {
    vw,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    rows: rows.slice(0, 18),
  };
});
console.log(JSON.stringify(probe, null, 2));
await context.close();
await browser.close();
