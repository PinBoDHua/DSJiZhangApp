import { chromium } from 'playwright-core';
import { mkdir, readFile, stat } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v03';
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

const compact = (value) => value.replace(/\s+/g, '');

await step('引导创建计件工作', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('李师傅（选填）').fill('计件测试');
  await page.getByPlaceholder('比如：城南工地 / 顺丰分拣').fill('手工编织');
  await page.getByRole('button', { name: '计件', exact: true }).click();
  await page.waitForTimeout(200);
  await page.locator('.onboarding-card input[type=number]').fill('1.5');
  await page.getByPlaceholder('件 / 米 / 平方').fill('个');
  await page.getByRole('button', { name: /开始记工/ }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.job-card').first().innerText()).includes('1.5/个'));
});

await step('记一笔计件工', async () => {
  await page.getByRole('button', { name: '记一笔工' }).click();
  await page.waitForTimeout(400);
  await page.getByLabel('计件数量').fill('40');
  const hoursField = page
    .locator('.entry-sheet .field')
    .filter({ hasText: '工时（选填）' })
    .locator('input');
  await hoursField.fill('3');
  await page.waitForTimeout(250);
  assert.equal(compact(await page.locator('.entry-preview-money').innerText()), '¥60.00');
  await page.locator('.entry-save').click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(400);
  const row = page.locator('.entry-row').first();
  const rowText = compact(await row.innerText());
  assert.ok(rowText.includes('40个·3h'), rowText);
  assert.ok(rowText.includes('¥60.00'), rowText);
  assert.ok(rowText.includes('计件'), rowText);
});

await step('结算计件并生成 PDF', async () => {
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.settle-card').first().click();
  await page.waitForTimeout(400);
  const draft = compact(await page.locator('.subpage').innerText());
  assert.ok(draft.includes('计件工资'), draft.slice(0, 120));
  assert.ok(draft.includes('40个×单价'), draft.slice(0, 200));
  await page.locator('.settle-footer .btn--primary').click();
  await page.waitForTimeout(300);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(800);
  const record = compact(await page.locator('.subpage').innerText());
  assert.ok(record.includes('40个'), record.slice(0, 220));
  await page.getByRole('button', { name: '工资条' }).click();
  await page.waitForTimeout(1000);
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('.payslip-footer .btn').filter({ hasText: 'PDF' }).click();
  const download = await downloadPromise;
  const pdfPath = `${OUT}/payslip.pdf`;
  await download.saveAs(pdfPath);
  const pdf = await readFile(pdfPath);
  assert.ok(download.suggestedFilename().endsWith('.pdf'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((await stat(pdfPath)).size > 30_000);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
});

await step('加密导出，文件不含明文', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.settings-row').filter({ hasText: '导出加密备份' }).click();
  await page.waitForTimeout(300);
  await page.getByLabel('备份密码', { exact: true }).fill('test-pass-123');
  await page.getByLabel('再输一次', { exact: true }).fill('test-pass-123');
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('.sheet-footer .btn--primary').filter({ hasText: '导出加密备份' }).click();
  const download = await downloadPromise;
  const path = `${OUT}/backup.enc.json`;
  await download.saveAs(path);
  const text = await readFile(path, 'utf8');
  assert.ok(text.includes('"encrypted":true'));
  assert.ok(!text.includes('手工编织'));
  assert.ok(!text.includes('计件测试'));
});

await step('错误密码被拒绝，正确密码恢复', async () => {
  await page.locator('input[type=file]').setInputFiles(`${OUT}/backup.enc.json`);
  await page.waitForTimeout(500);
  await page.getByLabel('备份密码', { exact: true }).fill('wrong-pass');
  await page.locator('.sheet-footer .btn--primary').filter({ hasText: '解密并导入' }).click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator('.form-error').innerText()).includes('密码错误'));
  await page.getByLabel('备份密码', { exact: true }).fill('test-pass-123');
  await page.locator('.sheet-footer .btn--primary').filter({ hasText: '解密并导入' }).click();
  await page.waitForTimeout(700);
  await page.locator('.dialog .btn--primary').click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator('.toast').innerText()).includes('备份已导入'));
});

await step('备份到期提醒', async () => {
  await page.evaluate(() =>
    localStorage.setItem(
      'xinshi.lastBackup',
      new Date(Date.now() - 20 * 86_400_000).toISOString(),
    ),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const nudge = compact(await page.locator('.backup-nudge').innerText());
  assert.ok(nudge.includes('该给账本留个底了'));
  assert.ok(nudge.includes('已20天没有备份'));
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0, '控制台不应有错误');
await context.close();
await browser.close();
