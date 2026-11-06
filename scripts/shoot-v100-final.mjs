import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v1.0';
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

async function dismissToast() {
  const close = page.getByRole('button', { name: '关闭提示' });
  if (await close.count()) {
    await close.click();
    await page.waitForTimeout(200);
  }
}

async function addEntry(jobName) {
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('.entry-sheet').getByRole('button', { name: new RegExp(jobName) }).click();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: '记上', exact: true }).click();
  await page.waitForTimeout(550);
  await dismissToast();
}

async function deleteEntryForJob(jobName) {
  await page.locator('.entry-row').filter({ hasText: jobName }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('.dialog').getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForTimeout(500);
  await dismissToast();
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(2200);

// 1-3 考勤照片
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(500);
await page.locator('.entry-row').first().click();
await page.waitForTimeout(450);
await page.getByRole('button', { name: '编辑', exact: true }).click();
await page.waitForTimeout(450);
const dataUrl = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const gradient = ctx.createLinearGradient(0, 0, 640, 480);
  gradient.addColorStop(0, '#315c4a');
  gradient.addColorStop(1, '#c48128');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 640, 480);
  return canvas.toDataURL('image/png');
});
await page.locator('.photo-input').setInputFiles({
  name: 'attendance.png',
  mimeType: 'image/png',
  buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
});
await page.locator('.photo-preview img').waitFor({ timeout: 6000 });
await page.locator('.entry-scroll').evaluate((element) => {
  element.scrollTop = element.scrollHeight;
});
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/01-entry-photo.png` });
await page.getByRole('button', { name: '保存', exact: true }).click();
await page.waitForTimeout(650);
await dismissToast();

await page.locator('.entry-row').first().click();
await page.waitForTimeout(500);
await page.locator('.detail-photo img').waitFor({ timeout: 6000 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/02-entry-detail-photo.png` });
await page.locator('.detail-photo').click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/03-photo-viewer.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(350);

// 4 回收站按工作筛选
await page.getByRole('button', { name: '记录', exact: true }).click();
await page.waitForTimeout(450);
await addEntry('城南工地');
await addEntry('顺丰夜班分拣');
await deleteEntryForJob('顺丰夜班分拣');
await deleteEntryForJob('城南工地');
await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /回收站/ }).click();
await page.waitForTimeout(450);
await page.locator('.trash-job-filters').getByRole('button', { name: /城南工地/ }).click();
await page.waitForTimeout(350);
await page.screenshot({ path: `${OUT}/04-trash-job-filter.png` });
await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.waitForTimeout(350);

// 5 关于 1.0.0
await page.getByRole('button', { name: '关于薪时' }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/05-about-1.0.0.png` });

await browser.close();
console.log('SHOTS v1.0 DONE');
