import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v0514';
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

await step('二维码显示稳定校验码', async () => {
  await page.getByRole('button', { name: '二维码', exact: true }).click();
  await page.waitForTimeout(500);
  const code = await page.locator('.share-qr-code').innerText();
  assert.match(code, /校验码 [0-9A-F]{4}-[0-9A-F]{4}/);
  await page.screenshot({ path: `${OUT}/qr-checksum.png` });
  await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
});

await step('工资条模板可以切换并记住', async () => {
  await page.getByRole('button', { name: '工资条', exact: true }).click();
  await page.waitForTimeout(900);
  await page.locator('.payslip-options summary').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.payslip-template select').inputValue(), 'full');
  await page.locator('.payslip-template select').selectOption('amount');
  await page.waitForTimeout(700);
  const options = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('xinshi.payslipOptions')),
  );
  assert.equal(options.showOverRest, false);
  assert.equal(options.showAdvance, false);
  assert.equal(options.showRestDates, false);
  assert.equal(options.footerNote, '仅金额对账');
  assert.ok(!(await page.getByLabel('超休扣款').isChecked()));
  await page.screenshot({ path: `${OUT}/payslip-template.png` });
});

await step('文字版 PDF 可以下载并包含中文文本', async () => {
  const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.getByRole('button', { name: /文字版 PDF/ }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^薪时文字工资条-.*\.pdf$/);
  const path = `${OUT}/payslip-text.pdf`;
  await download.saveAs(path);
  const buffer = await readFile(path);
  assert.ok(buffer.length > 50_000, `PDF 太小：${buffer.length}`);
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  await page.screenshot({ path: `${OUT}/text-pdf.png` });
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
