import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v060';
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

async function goDataSafety() {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /数据与安全/ }).click();
  await page.waitForTimeout(500);
}

async function backToProfile() {
  await page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
}

async function entryCount() {
  return page.evaluate(() => {
    const raw = localStorage.getItem('xinshi.state.v7');
    return raw ? JSON.parse(raw).entries.length : 0;
  });
}

await page.goto(BASE, { waitUntil: 'networkidle' });

await step('首次进入先看隐私政策，不同意不进入账本', async () => {
  await page.getByRole('heading', { name: '先说明白，再开始记工' }).waitFor();
  await page.screenshot({ path: `${OUT}/01-privacy-gate.png` });
  await page.getByRole('button', { name: '不同意' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('heading', { name: '需要同意隐私政策才能使用' }).waitFor();
  assert.equal(await page.locator('.onboarding').count(), 0);
  await page.screenshot({ path: `${OUT}/02-privacy-declined.png` });
  await page.getByRole('button', { name: '重新阅读并同意' }).click();
  await page.getByRole('button', { name: '查看完整隐私政策' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('heading', { name: '隐私政策' }).waitFor();
  assert.match(await page.locator('.privacy-content').innerText(), /不收集、不上传/);
  await page.screenshot({ path: `${OUT}/03-privacy-policy.png` });
  await page.getByRole('button', { name: '同意并继续' }).click();
  await page.waitForTimeout(500);
  await page.locator('.onboarding').waitFor();
});

await step('载入示例数据并自动留下本机快照', async () => {
  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(2400);
  await goDataSafety();
  await page.getByRole('button', { name: '现在拍一张' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: /查看本机快照/ }).click();
  await page.waitForTimeout(600);
  const count = await page.locator('.snap-item').count();
  assert.ok(count >= 1, `没有快照：${count}`);
  await page.screenshot({ path: `${OUT}/04-snapshots.png` });
  await backToProfile();
  await page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
});

let countBeforeDelete = 0;

await step('删除一笔工记后可以从本机时光机恢复', async () => {
  countBeforeDelete = await entryCount();
  assert.ok(countBeforeDelete >= 2, `示例工记太少：${countBeforeDelete}`);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '删除', exact: true }).last().click();
  await page.waitForTimeout(250);
  await page
    .getByRole('alertdialog', { name: '删除这笔工记？' })
    .getByRole('button', { name: '删除' })
    .click();
  await page.waitForTimeout(600);
  assert.equal(await entryCount(), countBeforeDelete - 1);

  await goDataSafety();
  await page.getByRole('button', { name: /查看本机快照/ }).click();
  await page.waitForTimeout(500);
  await page.locator('.snap-item').first().getByRole('button', { name: '恢复' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05-snapshot-restore-preview.png` });
  await page
    .getByRole('alertdialog', { name: '回到这个时间点？' })
    .getByRole('button', { name: '恢复这份快照' })
    .click();
  await page.waitForTimeout(900);
  assert.equal(await entryCount(), countBeforeDelete);
  await backToProfile();
  await page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
});

let exportedText = '';

await step('加密搬家包可以导出并带校验码', async () => {
  await goDataSafety();
  await page.getByRole('button', { name: /搬家到新手机/ }).click();
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="至少 6 位；不填则导出明文"]').fill('123456');
  await page.locator('input[placeholder="确认密码"]').fill('123456');
  await page.locator('input[placeholder="例如：生日后四位"]').fill('测试');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出搬家包' }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^薪时搬家包-\d{8}-\d{4}\.json$/);
  const path = `${OUT}/move-package.json`;
  await download.saveAs(path);
  exportedText = await readFile(path, 'utf8');
  const parsed = JSON.parse(exportedText);
  assert.equal(parsed.format, 'move');
  assert.equal(parsed.formatVersion, 1);
  assert.equal(parsed.passwordHint, '测试');
  assert.match(parsed.checksum, /^sha256:[0-9a-f]{64}$/);
  assert.ok(parsed.payload.data);
  assert.ok(!exportedText.includes('城南工地'), '加密包泄露了工作名');
  assert.match(await page.locator('.move-done').innerText(), /[0-9A-F]{8}/);
  await page.screenshot({ path: `${OUT}/06-move-export.png` });
  await page.getByRole('button', { name: '完成' }).click();
  await page.waitForTimeout(300);
  await backToProfile();
  await page.waitForTimeout(300);
});

await step('清空后可以用搬家包恢复', async () => {
  await goDataSafety();
  await page.getByRole('button', { name: /清空所有数据/ }).click();
  await page.waitForTimeout(300);
  await page
    .getByRole('alertdialog', { name: '清空所有数据？' })
    .getByRole('button', { name: '全部清空' })
    .click();
  await page.waitForTimeout(900);
  assert.equal(await entryCount(), 0);
  await page.locator('.onboarding').waitFor();
  await page.screenshot({ path: `${OUT}/07-after-clear-onboarding.png` });

  await page.getByRole('button', { name: '从本机快照找回' }).click();
  await page.waitForTimeout(600);
  assert.ok((await page.locator('.snap-item').count()) >= 1);
  await page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
  await page.locator('.onboarding').waitFor();

  await page.getByRole('button', { name: '我是换手机，从备份恢复' }).click();
  await page.waitForTimeout(400);
  await page.locator('.move-sheet input[type=file]').setInputFiles({
    name: '薪时搬家包.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportedText),
  });
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="输入导出时设置的密码"]').fill('123456');
  await page.getByRole('button', { name: '解密并预览' }).click();
  await page.waitForTimeout(800);
  await page.locator('.move-compare').waitFor();
  assert.match(await page.locator('.move-preview-head').innerText(), /校验通过/);
  await page.screenshot({ path: `${OUT}/08-move-import-preview.png` });
  await page.getByRole('button', { name: '用包覆盖本机' }).click();
  await page.waitForTimeout(300);
  await page
    .getByRole('alertdialog', { name: '用搬家包覆盖本机？' })
    .getByRole('button', { name: '覆盖并导入' })
    .click();
  await page.waitForTimeout(900);
  assert.ok((await entryCount()) >= 2);
  await goDataSafety();
  await page.getByRole('button', { name: /查看本机快照/ }).click();
  await page.waitForTimeout(500);
  assert.ok((await page.locator('.snap-item').count()) >= 1);
  await page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(300);
});

await step('被篡改的搬家包会被拒绝', async () => {
  const tampered = JSON.parse(exportedText);
  tampered.payload.data = `${tampered.payload.data.slice(0, -8)}AAAAAAAA`;
  const before = await entryCount();
  await page.getByRole('button', { name: /导入搬家包 \/ 备份/ }).click();
  await page.waitForTimeout(300);
  await page.locator('.move-sheet input[type=file]').setInputFiles({
    name: '被改过的搬家包.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tampered)),
  });
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="输入导出时设置的密码"]').fill('123456');
  await page.getByRole('button', { name: '解密并预览' }).click();
  await page.waitForTimeout(600);
  assert.match(await page.locator('.move-error').innerText(), /校验失败/);
  assert.equal(await entryCount(), before);
  await page.screenshot({ path: `${OUT}/08-move-tampered.png` });
  await page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(300);
});

await step('账本体检发现孤儿锁定并一键解锁', async () => {
  await page.evaluate(() => {
    const key = 'xinshi.state.v7';
    const state = JSON.parse(localStorage.getItem(key));
    state.entries[0].settlementId = 'missing-settlement';
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await goDataSafety();
  await page.getByRole('button', { name: '体检', exact: true }).click();
  await page.waitForTimeout(700);
  assert.match(await page.locator('.subpage-scroll').innerText(), /被不存在的结算单锁住/);
  await page.screenshot({ path: `${OUT}/09-health.png` });
  await page.getByRole('button', { name: '一键解锁' }).click();
  await page.waitForTimeout(800);
  const cleared = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('xinshi.state.v7'));
    return state.entries.every((entry) => !entry.settlementId);
  });
  assert.equal(cleared, true);
  await page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
});

await step('Excel 对账表可以导出', async () => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Excel 对账表/ }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^薪时账本-\d{8}\.xlsx$/);
  const path = `${OUT}/ledger.xlsx`;
  await download.saveAs(path);
  const buffer = await readFile(path);
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 4000, `Excel 太小：${buffer.length}`);
  await page.screenshot({ path: `${OUT}/10-excel.png` });
});

await step('数据与安全页没有横向溢出', async () => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.equal(overflow, false);
  await page.screenshot({ path: `${OUT}/11-data-safety.png` });
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
