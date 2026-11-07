import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v100';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  serviceWorkers: 'block',
});
await context.addInitScript(() =>
  localStorage.setItem('xinshi.privacyConsent', '2026-11-05'),
);
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

async function dismissToast() {
  const close = page.getByRole('button', { name: '关闭提示' });
  if (await close.count()) {
    await close.click();
    await page.waitForTimeout(250);
  }
}

async function openRecords() {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(500);
}

async function addEntry(jobName, { saveLabel = '记上' } = {}) {
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  await page.waitForTimeout(550);
  await page.locator('.entry-sheet').getByRole('button', { name: new RegExp(jobName) }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: saveLabel, exact: true }).click();
  await page.waitForTimeout(600);
}

async function deleteEntryForJob(jobName) {
  await page.locator('.entry-row').filter({ hasText: jobName }).first().click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.dialog').getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForTimeout(600);
  await dismissToast();
}

async function openTrash() {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: /回收站/ }).click();
  await page.waitForTimeout(450);
  assert.ok((await page.locator('.sheet-head h2').innerText()).includes('回收站'));
}

async function closeSheet() {
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(350);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(1900);

await step('工记可拍照加水印、详情看大图、再移除照片', async () => {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.fillStyle = '#2f6f55';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '48px sans-serif';
    ctx.fillText('考勤', 220, 250);
    return canvas.toDataURL('image/png');
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

  await openRecords();
  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('.photo-input').setInputFiles({
    name: 'attendance.png',
    mimeType: 'image/png',
    buffer,
  });
  await page.locator('.photo-preview img').waitFor({ timeout: 6000 });
  assert.ok(await page.locator('.photo-preview').isVisible(), '照片预览没有出现');

  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(350);
  const overflow = await page.locator('.entry-sheet').evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  assert.equal(overflow, false, '320px 记一笔抽屉横向溢出');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForTimeout(700);
  await dismissToast();

  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(500);
  await page.locator('.detail-photo img').waitFor({ timeout: 6000 });
  assert.ok(await page.locator('.detail-photo').isVisible(), '详情没有显示照片');
  await page.screenshot({ path: `${OUT}/01-entry-photo.png` });

  await page.locator('.detail-photo').click();
  await page.waitForTimeout(400);
  assert.ok(await page.locator('.photo-viewer').isVisible(), '大图没有打开');
  await page.screenshot({ path: `${OUT}/02-photo-viewer.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.photo-viewer').count(), 0, 'Esc 没有关闭大图');
  assert.equal(await page.locator('.sheet').count(), 1, 'Esc 把工记详情一起关掉了');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForTimeout(700);
  await dismissToast();

  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.detail-photo').count(), 0, '移除照片后详情仍有照片');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
});

await step('回收站按工作筛选，汇总跟随筛选变化', async () => {
  await openRecords();
  await addEntry('城南工地');
  await dismissToast();
  await addEntry('顺丰夜班分拣');
  await dismissToast();

  await deleteEntryForJob('顺丰夜班分拣');
  await deleteEntryForJob('城南工地');

  await openTrash();
  assert.equal(await page.locator('.trash-row').count(), 2, '回收站应有 2 条工记');
  assert.equal(await page.locator('.trash-job-filters').count(), 1, '两个工作时没有显示工作筛选');
  await page.locator('.trash-job-filters').getByRole('button', { name: /城南工地/ }).click();
  await page.waitForTimeout(350);
  assert.equal(await page.locator('.trash-row').count(), 1, '按工作筛选后行数不对');
  assert.ok(
    (await page.locator('.trash-summary').innerText()).includes('1 条'),
    '筛选后汇总没有跟着变化',
  );
  await page.locator('.trash-job-filters').getByRole('button', { name: '全部工作' }).click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.trash-row').count(), 2);
  await page.screenshot({ path: `${OUT}/03-trash-job-filter.png` });
  await closeSheet();
});

await step('记工覆盖同日休息时，休息进入回收站并可看到恢复原因', async () => {
  await openRecords();
  await page.getByRole('button', { name: '记休息' }).click();
  await page.waitForTimeout(400);
  await page.locator('.rest-sheet').getByRole('button', { name: /城南工地/ }).click();
  await page.getByRole('button', { name: '标为休息', exact: true }).click();
  await page.waitForTimeout(500);
  await dismissToast();

  await addEntry('城南工地');
  const toastText = await page.locator('.toast').innerText();
  assert.ok(
    toastText.includes('休息已移到回收站'),
    `记工提示没有说明休息去向：${toastText}`,
  );
  await dismissToast();

  await openTrash();
  const restRow = page.locator('.trash-row').filter({ has: page.locator('.trash-kind--rest') });
  assert.equal(await restRow.count(), 1, '回收站没有收到被覆盖的休息');
  assert.ok(
    (await restRow.locator('.trash-block').innerText()).includes('这天已有工记'),
    '休息恢复原因没有显示工记冲突',
  );
  await page.screenshot({ path: `${OUT}/04-trash-rest-block.png` });
  await closeSheet();
});

await step(`关于页显示 ${APP_VERSION}，控制台无错误`, async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(450);
  const profileText = await page.locator('body').innerText();
  assert.ok(profileText.includes(`v${APP_VERSION}`), `关于页没有显示 v${APP_VERSION}`);
  assert.deepEqual(errors, [], `控制台有错误：${errors.join('\n')}`);
});

await browser.close();
console.log(`ALL PASS v${APP_VERSION}`);
