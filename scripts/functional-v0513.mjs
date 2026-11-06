import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v0513';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
  acceptDownloads: true,
});
const page = await context.newPage();
await page.addInitScript(() => localStorage.setItem('xinshi.privacyConsent', '2026-11-05'));
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

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(700);
const dates = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
  const entry = state.entries.find((item) => item.note === '水电验收');
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return {
    entryDate: entry.date,
    today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
});
const weekdayCN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
  new Date(`${dates.entryDate}T12:00:00`).getDay()
];
await page.getByRole('button', { name: '结算', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /核对结算/ }).last().click();
await page.waitForTimeout(500);
await page.locator('.settle-footer').getByRole('button', { name: '确认结算' }).click();
await page.waitForTimeout(250);
await page
  .getByRole('alertdialog', { name: '确认结算这一期？' })
  .getByRole('button', { name: '确认结算' })
  .click();
await page.waitForTimeout(800);

await step('结算单二维码可以预览和保存 PNG', async () => {
  await page.getByRole('button', { name: '二维码', exact: true }).click();
  await page.waitForTimeout(500);
  const sheet = page.locator('.sheet');
  assert.ok((await sheet.innerText()).includes('分享结算二维码'));
  const src = await page.locator('.share-qr-card img').getAttribute('src');
  assert.ok(src?.startsWith('data:image/'), src?.slice(0, 30));
  const downloadPromise = page.waitForEvent('download');
  await sheet.getByRole('button', { name: '保存二维码' }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.png'));
  await download.saveAs(`${OUT}/qr.png`);
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
});

await step('工资条可以自定义明细行并记住偏好', async () => {
  await page.getByRole('button', { name: '工资条', exact: true }).click();
  await page.locator('.payslip-image').waitFor({ state: 'visible' });
  await page.locator('.payslip-options summary').click();
  await page.waitForTimeout(250);
  const bonus = page.getByLabel('奖金补贴');
  assert.ok(await bonus.isChecked());
  await bonus.uncheck();
  await page.waitForTimeout(800);
  const options = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.payslipOptions')),
  );
  assert.equal(options.showBonus, false);
  assert.ok(await page.getByLabel('奖金补贴').isVisible());
  await page.screenshot({ path: `${OUT}/payslip-options.png` });
  await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
});

await step('月度考勤可以导出 CSV', async () => {
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '月度考勤' }).click();
  await page.waitForTimeout(500);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), `薪时考勤-${dates.today.slice(0, 7)}.csv`);
  const path = `${OUT}/attendance.csv`;
  await download.saveAs(path);
  const csv = await readFile(path, 'utf8');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('日期,星期,城南工地,顺丰夜班分拣,老宅装修,礼盒包装,当日工时'));
  assert.ok(csv.includes(`${dates.entryDate},${weekdayCN},未记,未记,班 6h,未记,6`));
  assert.ok(csv.includes('合计,'));
  await page.screenshot({ path: `${OUT}/attendance-csv.png` });
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
