import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';

// 子页面（数据与安全 / 工作管理 / 月度考勤）在多分辨率下的溢出与非安全区检查
const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.env.AUDIT_OUT || 'test-results-responsive-subpages';
const SIMULATE_INSETS = process.argv.includes('--insets');
const INSETS = { top: 41, bottom: 16 };

await mkdir(OUT, { recursive: true });

const VIEWPORTS = [
  { w: 320, h: 568, name: '320x568-small' },
  { w: 407, h: 904, name: '407x904-userphone' },
  { w: 904, h: 407, name: '904x407-landscape' },
  { w: 1280, h: 800, name: '1280x800-desktop' },
];

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
  const inner = document.querySelector('.subpage-head');
  return {
    vw,
    vh,
    overflowX: document.documentElement.scrollWidth - vw,
    offenders,
    innerTop: inner ? Math.round(inner.getBoundingClientRect().top) : null,
    innerBottom: inner ? Math.round(inner.getBoundingClientRect().bottom) : null,
  };
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const report = [];

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
  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(2200);

  const record = async (label) => {
    const data = await page.evaluate(measure);
    report.push({ viewport: viewport.name, page: label, ...data });
    await page.screenshot({ path: `${OUT}/${viewport.name}-${label}.png` });
  };

  // 我的 → 数据与安全
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /数据与安全/ }).click();
  await page.waitForTimeout(700);
  await record('数据与安全');
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(500);

  // 我的 → 工作管理
  await page.getByRole('button', { name: /工作管理/ }).click();
  await page.waitForTimeout(700);
  await record('工作管理');
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(500);

  // 记录 → 月度考勤
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(600);
  const attendance = page.getByRole('button', { name: /考勤/ });
  if (await attendance.count()) {
    await attendance.first().click();
    await page.waitForTimeout(800);
    await record('月度考勤');
  }

  await context.close();
  console.log(`done ${viewport.name}`);
}

await browser.close();

const bad = report.filter((row) => {
  if (row.overflowX > 1 || row.offenders.length > 0) return true;
  if (SIMULATE_INSETS && row.innerTop !== null && row.innerTop < INSETS.top - 1) return true;
  if (SIMULATE_INSETS && row.innerBottom !== null && row.vh - row.innerBottom > INSETS.bottom + 1) {
    // 子页面底部不强制让手势条，这里只记录不判失败
    return false;
  }
  return false;
});

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2), 'utf8');
await writeFile(
  `${OUT}/summary.md`,
  [
    `# 子页面分辨率审计 ${SIMULATE_INSETS ? '（含模拟刘海 / 手势条）' : '（基线）'}`,
    '',
    `检查组合：${report.length} 次`,
    `发现问题组合：${bad.length}`,
    '',
    ...bad.map(
      (row) =>
        `- **${row.viewport} / ${row.page}**：横向溢出 ${row.overflowX}px，内容 top=${row.innerTop}，越界元素 ${
          row.offenders.map((item) => `${item.tag}.${item.cls}[${item.left},${item.right}]`).join(' ') || '无'
        }`,
    ),
  ].join('\n'),
  'utf8',
);

console.log(`\n问题组合 ${bad.length} / ${report.length}`);
for (const row of report) {
  console.log(
    `${row.viewport} | ${row.page} | overflowX=${row.overflowX} | top=${row.innerTop} | offenders=${row.offenders
      .map((item) => `${item.tag}.${item.cls}`)
      .join(',')}`,
  );
}
