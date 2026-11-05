import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';

const OUT = 'shots/android-v060';
await mkdir(OUT, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages()[0] ?? (await context.waitForEvent('page'));
await page.setViewportSize({ width: 390, height: 844 }).catch(() => undefined);
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

console.log('url:', page.url());
console.log('gate:', await page.locator('.privacy-gate').count());
console.log('onboarding:', await page.locator('.onboarding').count());

if (await page.locator('.privacy-gate').count()) {
  await page.getByRole('button', { name: '同意并继续' }).click();
  await page.waitForTimeout(800);
}

if (await page.locator('.onboarding').count()) {
  await page.getByRole('button', { name: /先看看示例数据/ }).click();
  await page.waitForTimeout(1800);
}

await page.screenshot({ path: `${OUT}/01-home.png` });
await page.getByRole('button', { name: '我的', exact: true }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: /数据与安全/ }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/02-data-safety.png` });

const switchButton = page.getByRole('switch', { name: '自动备份' });
console.log('switch disabled:', await switchButton.isDisabled());
if (!(await switchButton.isDisabled())) {
  const on = (await switchButton.getAttribute('aria-checked')) === 'true';
  if (!on) await switchButton.click();
  await page.waitForTimeout(2500);
}

const auto = await page.evaluate(() => {
  try {
    return {
      auto: JSON.parse(localStorage.getItem('xinshi.autoBackup') || 'null'),
      lastBackup: localStorage.getItem('xinshi.lastBackup'),
      consent: localStorage.getItem('xinshi.privacyConsent'),
      stateKey: Object.keys(localStorage).filter((key) => key.startsWith('xinshi.state')),
    };
  } catch (error) {
    return { error: String(error) };
  }
});
console.log('localStorage:', JSON.stringify(auto, null, 2));
await page.screenshot({ path: `${OUT}/03-auto-backup-on.png` });

await page.getByRole('button', { name: /查看本机快照/ }).click();
await page.waitForTimeout(700);
console.log('snapshots:', await page.locator('.snap-item').count());
await page.screenshot({ path: `${OUT}/04-snapshots.png` });

console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
