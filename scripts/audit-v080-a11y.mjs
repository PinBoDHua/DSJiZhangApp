import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v080-a11y';
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
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(1800);

const measure = () =>
  page.evaluate(() => {
    const rows = [];
    const nodes = document.querySelectorAll(
      'button, [role="switch"], input:not([type="hidden"]), textarea, select, a[href], [tabindex]:not([tabindex="-1"])',
    );
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width < 2 || rect.height < 2) continue;
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (rect.width < 40 || rect.height < 40) {
        rows.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === 'string' ? el.className : '',
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
    }
    return rows;
  });

const tabs = ['首页', '记录', '结算', '统计', '我的'];
const report = {};
for (const tab of tabs) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(500);
  report[tab] = await measure();
}
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '搜索工记' }).click();
await page.waitForTimeout(500);
report['搜索'] = await measure();
await writeFile(`${OUT}/tap-targets.json`, JSON.stringify(report, null, 2), 'utf8');
for (const [name, rows] of Object.entries(report)) {
  console.log(`\n== ${name} (${rows.length})`);
  for (const row of rows.slice(0, 20)) {
    console.log(`${row.tag}.${row.cls} "${row.label}" ${row.w}x${row.h}`);
  }
}
await browser.close();
