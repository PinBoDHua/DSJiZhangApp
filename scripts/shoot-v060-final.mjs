import { chromium } from 'playwright-core';
import { mkdir, readFile } from 'node:fs/promises';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'shots/v0.6';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function newPage(viewport = { width: 390, height: 844 }, consent = true) {
  const context = await browser.newContext({
    viewport,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  if (consent) {
    await context.addInitScript(() =>
      localStorage.setItem('xinshi.privacyConsent', '2026-11-05'),
    );
  }
  const page = await context.newPage();
  return { context, page };
}

async function goDataSafety(page) {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: /数据与安全/ }).click();
  await page.waitForTimeout(600);
}

const phone = await newPage();
await phone.page.goto(BASE, { waitUntil: 'networkidle' });
await phone.page.getByRole('button', { name: /先看看示例数据/ }).click();
await phone.page.waitForTimeout(2200);
await phone.page.screenshot({ path: `${OUT}/01-home.png` });

await goDataSafety(phone.page);
await phone.page.getByRole('button', { name: '立即备份' }).first().click();
await phone.page.waitForTimeout(3300);
await phone.page.screenshot({ path: `${OUT}/02-data-safety.png` });

await phone.page.getByRole('button', { name: /查看本机快照/ }).click();
await phone.page.waitForTimeout(600);
if ((await phone.page.locator('.snap-item').count()) === 0) {
  await phone.page.getByRole('button', { name: '现在拍一张' }).click();
  await phone.page.waitForTimeout(3300);
}
await phone.page.screenshot({ path: `${OUT}/03-snapshots.png` });
await phone.page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
await phone.page.waitForTimeout(300);

await phone.page.getByRole('button', { name: /搬家到新手机/ }).click();
await phone.page.waitForTimeout(400);
await phone.page.locator('input[placeholder="至少 6 位；不填则导出明文"]').fill('123456');
await phone.page.locator('input[placeholder="确认密码"]').fill('123456');
await phone.page.locator('input[placeholder="例如：生日后四位"]').fill('家里地名 + 门牌');
await phone.page.screenshot({ path: `${OUT}/04-move-export.png` });
await phone.page.locator('.sheet').getByRole('button', { name: '关闭', exact: true }).click();
await phone.page.waitForTimeout(300);

await phone.page.evaluate(() => {
  const key = 'xinshi.state.v7';
  const state = JSON.parse(localStorage.getItem(key));
  state.entries[0].settlementId = 'missing-settlement';
  localStorage.setItem(key, JSON.stringify(state));
});
await phone.page.reload({ waitUntil: 'networkidle' });
await phone.page.waitForTimeout(800);
await goDataSafety(phone.page);
await phone.page.getByRole('button', { name: '体检', exact: true }).click();
await phone.page.waitForTimeout(700);
await phone.page.screenshot({ path: `${OUT}/05-health.png` });
await phone.page.locator('.subpage-head').getByRole('button', { name: '返回' }).click();
await phone.page.waitForTimeout(300);

await phone.page.getByRole('button', { name: /导入搬家包 \/ 备份/ }).click();
await phone.page.waitForTimeout(400);
const packageText = await readFile('test-results-v060/move-package.json', 'utf8');
await phone.page.locator('.move-sheet input[type=file]').setInputFiles({
  name: '薪时搬家包.json',
  mimeType: 'application/json',
  buffer: Buffer.from(packageText),
});
await phone.page.waitForTimeout(400);
await phone.page.locator('input[placeholder="输入导出时设置的密码"]').fill('123456');
await phone.page.getByRole('button', { name: '解密并预览' }).click();
await phone.page.waitForTimeout(700);
await phone.page.screenshot({ path: `${OUT}/06-move-import.png` });
await phone.context.close();

const desktop = await newPage({ width: 1280, height: 900 });
await desktop.page.goto(BASE, { waitUntil: 'networkidle' });
await desktop.page.getByRole('button', { name: /先看看示例数据/ }).click();
await desktop.page.waitForTimeout(2200);
await goDataSafety(desktop.page);
await desktop.page.getByRole('button', { name: '立即备份' }).first().click();
await desktop.page.waitForTimeout(3300);
await desktop.page.screenshot({ path: `${OUT}/07-desktop-data-safety.png` });
await desktop.context.close();

const gate = await newPage({ width: 390, height: 844 }, false);
await gate.page.goto(BASE, { waitUntil: 'networkidle' });
await gate.page.waitForTimeout(300);
await gate.page.screenshot({ path: `${OUT}/08-privacy-gate.png` });
await gate.page.getByRole('button', { name: '查看完整隐私政策' }).click();
await gate.page.waitForTimeout(400);
await gate.page.screenshot({ path: `${OUT}/09-privacy-policy.png` });
await gate.context.close();

await browser.close();
console.log('screenshots ready');
