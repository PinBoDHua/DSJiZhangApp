import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SIMULATE_INSETS = process.argv.includes('--insets');
const OUT =
  process.env.AUDIT_OUT ||
  (SIMULATE_INSETS ? 'test-results-responsive-insets' : 'test-results-responsive');
// 真机 Redmi Note 13 Pro 5G：1220x2712 @480dpi -> 407x904 CSS；状态栏 122px、手势条 48px
const INSETS = { top: 41, bottom: 16 };

await mkdir(OUT, { recursive: true });

const VIEWPORTS = [
  { w: 320, h: 568, name: '320x568-small' },
  { w: 360, h: 640, name: '360x640-ldplayer' },
  { w: 360, h: 780, name: '360x780-android' },
  { w: 375, h: 667, name: '375x667-iphone8' },
  { w: 390, h: 844, name: '390x844-iphone13' },
  { w: 407, h: 904, name: '407x904-userphone' },
  { w: 412, h: 915, name: '412x915-pixel' },
  { w: 430, h: 932, name: '430x932-iphone15pm' },
  { w: 540, h: 720, name: '540x720-fold' },
  { w: 600, h: 960, name: '600x960-tablet' },
  { w: 768, h: 1024, name: '768x1024-tablet' },
  { w: 1024, h: 768, name: '1024x768-tablet-land' },
  { w: 1280, h: 800, name: '1280x800-desktop' },
  { w: 904, h: 407, name: '904x407-landscape' },
  { w: 667, h: 375, name: '667x375-landscape-small' },
];

const TABS = ['首页', '记录', '结算', '统计', '我的'];

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const report = [];

/** 在页面里量一遍：横向溢出、越界元素、底栏 / FAB 位置、内容顶部 */
function measure() {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.right <= vw + 1 && rect.left >= -1) continue;
    let parent = el.parentElement;
    let clipped = false;
    while (parent && parent !== document.body) {
      const style = getComputedStyle(parent);
      // 横向滚动容器 / overflow:hidden 裁剪的装饰不撑出页面滚动条
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        clipped = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (clipped) continue;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    offenders.push({ tag: el.tagName.toLowerCase(), cls, left: Math.round(rect.left), right: Math.round(rect.right) });
    if (offenders.length >= 6) break;
  }
  const nav = document.querySelector('.bottom-nav');
  const fab = document.querySelector('.fab');
  const navRect = nav ? nav.getBoundingClientRect() : null;
  const fabRect = fab ? fab.getBoundingClientRect() : null;
  const mainEl = document.querySelector('.app-main');
  const brandEl = document.querySelector('.onboarding-top');
  const subEl = document.querySelector('.subpage-head');
  return {
    vw,
    vh,
    overflowX: document.documentElement.scrollWidth - vw,
    offenders,
    nav: navRect
      ? { bottom: Math.round(navRect.bottom), right: Math.round(navRect.right), width: Math.round(navRect.width) }
      : null,
    fab: fabRect ? { bottom: Math.round(fabRect.bottom), right: Math.round(fabRect.right) } : null,
    navInsideViewport: navRect ? navRect.bottom <= vh + 1 && navRect.right <= vw + 1 : true,
    navBottomGap: navRect ? Math.round(vh - navRect.bottom) : null,
    mainTop: Math.round(
      mainEl
        ? mainEl.getBoundingClientRect().top
        : brandEl
          ? brandEl.getBoundingClientRect().top
          : subEl
            ? subEl.getBoundingClientRect().top
            : 0,
    ),
  };
}

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.w, height: viewport.h },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  });
  await context.addInitScript(
    ({ simulate, insets }) => {
      localStorage.setItem('xinshi.privacyConsent', '2026-11-05');
      localStorage.setItem('xinshi.theme', 'light');
      if (simulate) {
        document.addEventListener('DOMContentLoaded', () => {
          const root = document.documentElement;
          root.style.setProperty('--safe-top', `${insets.top}px`);
          root.style.setProperty('--safe-bottom', `${insets.bottom}px`);
        });
      }
    },
    { simulate: SIMULATE_INSETS, insets: INSETS },
  );
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`[pageerror] ${viewport.name}: ${error}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  // 引导页是用户看到的第一屏，单独量一次
  const onboarding = await page.evaluate(measure);
  report.push({ viewport: viewport.name, page: '引导页', ...onboarding });
  await page.screenshot({ path: `${OUT}/${viewport.name}-引导页.png` });

  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(2200);

  for (const tab of TABS) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(650);
    const data = await page.evaluate(measure);
    report.push({ viewport: viewport.name, page: tab, ...data });
    await page.screenshot({ path: `${OUT}/${viewport.name}-${tab}.png` });
  }

  // 记一笔：底部抽屉在矮屏 / 横屏下最容易顶出屏幕
  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(400);
  const fab = page.locator('.fab');
  if (await fab.count()) {
    await fab.click();
    await page.waitForTimeout(700);
    const data = await page.evaluate(measure);
    report.push({ viewport: viewport.name, page: '记一笔', ...data });
    await page.screenshot({ path: `${OUT}/${viewport.name}-记一笔.png` });
    const close = page.getByRole('button', { name: '关闭', exact: true });
    if (await close.count()) await close.first().click().catch(() => {});
    await page.waitForTimeout(300);
  }

  // 记录 → 搜索
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(500);
  const search = page.getByRole('button', { name: '搜索工记' });
  if (await search.count()) {
    await search.first().click();
    await page.waitForTimeout(500);
    await page.locator('.search-input').fill('11');
    await page.waitForTimeout(300);
    const data = await page.evaluate(measure);
    report.push({ viewport: viewport.name, page: '搜索', ...data });
    await page.screenshot({ path: `${OUT}/${viewport.name}-搜索.png` });
    await page.getByRole('button', { name: '返回' }).click();
    await page.waitForTimeout(400);
  }

  // 统计 → 本年
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await page.waitForTimeout(500);
  const yearButton = page.getByRole('button', { name: '本年', exact: true });
  if (await yearButton.count()) {
    await yearButton.first().click();
    await page.waitForTimeout(600);
    const data = await page.evaluate(measure);
    report.push({ viewport: viewport.name, page: '年度统计', ...data });
    await page.screenshot({ path: `${OUT}/${viewport.name}-年度统计.png` });
  }
  await context.close();
  console.log(`done ${viewport.name}`);
}

await browser.close();

const bad = report.filter((row) => {
  if (row.overflowX > 1 || row.offenders.length > 0 || !row.navInsideViewport) return true;
  if (!SIMULATE_INSETS) return false;
  // 模拟刘海 / 手势条：内容不能顶到状态栏下，底栏不能被手势条压住
  if (row.mainTop < INSETS.top - 1) return true;
  if (row.navBottomGap !== null && row.navBottomGap < INSETS.bottom - 1) return true;
  return false;
});

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2), 'utf8');
await writeFile(
  `${OUT}/summary.md`,
  [
    `# 分辨率矩阵审计 ${SIMULATE_INSETS ? '（含模拟刘海 / 手势条）' : '（基线）'}`,
    '',
    `检查组合：${VIEWPORTS.length} 个分辨率 × ${TABS.length + 4} 个页面 = ${report.length} 次`,
    `发现问题组合：${bad.length}`,
    '',
    ...bad.map(
      (row) =>
        `- **${row.viewport} / ${row.page}**：横向溢出 ${row.overflowX}px，内容 top=${row.mainTop}，底栏距底=${row.navBottomGap}，越界元素 ${
          row.offenders.map((item) => `${item.tag}.${item.cls}[${item.left},${item.right}]`).join(' ') || '无'
        }`,
    ),
  ].join('\n'),
  'utf8',
);

console.log(`\n问题组合 ${bad.length} / ${report.length}`);
for (const row of bad.slice(0, 25)) {
  console.log(
    `${row.viewport} | ${row.page} | overflowX=${row.overflowX} | top=${row.mainTop} | navGap=${row.navBottomGap} | offenders=${row.offenders
      .map((item) => `${item.tag}.${item.cls}`)
      .join(',')}`,
  );
}
