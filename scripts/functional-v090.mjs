import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:4173';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'test-results-v090';
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

async function dismissToast() {
  const close = page.getByRole('button', { name: '关闭提示' });
  if (await close.count()) {
    await close.click();
    await page.waitForTimeout(250);
  }
}

async function restoreFirst() {
  await page.getByRole('button', { name: /恢复 / }).first().click();
  await page.waitForTimeout(400);
  const text = await page.locator('.toast').innerText();
  assert.ok(text.includes('已恢复'), `恢复提示异常：${text}`);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /先看看示例数据/ }).click();
await page.waitForTimeout(1900);

await step('删除工记后进入回收站，可从回收站恢复', async () => {
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(500);
  const before = await page.locator('.entry-row').count();
  assert.ok(before > 0, '示例数据没有工记');
  await page.locator('.entry-row').first().click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForTimeout(250);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.toast').innerText()).includes('工记已删除'));
  await dismissToast();

  await openTrash();
  assert.ok((await page.locator('.trash-summary').innerText()).includes('1 条'));
  assert.ok((await page.locator('.trash-filters').innerText()).includes('工记'));
  assert.ok((await page.locator('.trash-list').innerText()).includes('工记'));
  assert.ok(
    await page.evaluate(() => document.activeElement?.classList.contains('sheet')),
    '打开回收站后焦点没有进入抽屉',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
    '关闭',
    'Tab 没有停在抽屉内',
  );
  await page.screenshot({ path: `${OUT}/01-trash-entry.png` });

  await page.getByRole('button', { name: /彻底删除 / }).first().click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.dialog').count(), 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.dialog').count(), 0, 'Esc 没有关闭确认框');
  assert.equal(await page.locator('.sheet').count(), 1, 'Esc 连回收站抽屉一起关掉了');

  await page.setViewportSize({ width: 320, height: 720 });
  await page.waitForTimeout(350);
  const overflow = await page.locator('.sheet').evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  assert.equal(overflow, false, '回收站抽屉 320px 横向溢出');
  await page.screenshot({ path: `${OUT}/02-trash-320.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  await restoreFirst();
  await closeSheet();
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.entry-row').count(), before, '恢复后工记数量不一致');
});

await step('取消休息后进入回收站，可从回收站恢复', async () => {
  await page.getByRole('button', { name: '月度考勤' }).click();
  await page.waitForTimeout(650);
  const restCells = page.locator('.attendance-cell.is-rest');
  assert.ok((await restCells.count()) > 0, '示例数据没有休息日');
  await restCells.first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: '取消这天的休息' }).click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.toast').innerText()).includes('已取消'));
  await dismissToast();
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(500);

  await openTrash();
  await page.locator('.trash-filters').getByRole('button', { name: /休息/ }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.trash-list').innerText()).includes('休息'));
  await page.screenshot({ path: `${OUT}/03-trash-rest.png` });
  await restoreFirst();
  await closeSheet();

  await page.getByRole('button', { name: '记录', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '月度考勤' }).click();
  await page.waitForTimeout(650);
  assert.equal(await page.locator('.attendance-cell.is-rest').count(), await restCells.count());
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(400);
});

await step('删除借支后进入回收站，可从回收站恢复', async () => {
  await page.getByRole('button', { name: '结算', exact: true }).click();
  await page.waitForTimeout(600);
  await page.locator('.settle-card').filter({ hasText: '老宅装修' }).first().click();
  await page.waitForTimeout(700);
  await page.getByText('借支抵扣').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: /补记借支/ }).click();
  await page.waitForTimeout(450);
  await page.getByPlaceholder('0.00').fill('88');
  await page.getByRole('button', { name: '记上借支' }).click();
  await page.waitForTimeout(500);
  await dismissToast();
  const deleteAdvance = page.getByRole('button', { name: '删除借支' });
  assert.ok((await deleteAdvance.count()) > 0, '补记后没有可删除的借支');
  await deleteAdvance.first().click();
  await page.waitForTimeout(250);
  await page.locator('.dialog .btn--danger').click();
  await page.waitForTimeout(400);
  assert.ok((await page.locator('.toast').innerText()).includes('借支已删除'));
  await dismissToast();
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(600);

  await openTrash();
  await page.locator('.trash-filters').getByRole('button', { name: /借支/ }).click();
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.trash-list').innerText()).includes('老宅装修'));
  await page.screenshot({ path: `${OUT}/04-trash-advance.png` });
  await restoreFirst();
  await closeSheet();
});

await step('有休息记录的工作只能归档，删除入口不再出现', async () => {
  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: /工作管理/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '新建工作' }).first().click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('例如：城南工地 / 顺丰分拣').fill('回收测试工作');
  await page.locator('.job-editor-footer .btn--primary').click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(450);

  await page.getByRole('button', { name: '首页', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '记休息' }).click();
  await page.waitForTimeout(450);
  await page.locator('.job-choice').filter({ hasText: '回收测试工作' }).click();
  await page.getByRole('button', { name: '标为休息' }).click();
  await page.waitForTimeout(450);
  await dismissToast();

  await page.getByRole('button', { name: '我的', exact: true }).click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: /工作管理/ }).click();
  await page.waitForTimeout(500);
  await page.locator('.job-manage-card').filter({ hasText: '回收测试工作' }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.getByText('删除工作', { exact: true }).count(), 0, '仍显示删除工作');
  const hint = await page.locator('.editor-delete-hint').innerText();
  assert.ok(hint.includes('休息'), `删除提示没有提到休息：${hint}`);
  await page.screenshot({ path: `${OUT}/05-job-rest-guard.png`, fullPage: true });
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(450);
  await page.getByRole('button', { name: '返回' }).click();
  await page.waitForTimeout(450);
});

await step('全部恢复后回收站回到空状态', async () => {
  await openTrash();
  assert.ok((await page.locator('.empty-state').innerText()).includes('回收站是空的'));
  assert.equal(await page.locator('.trash-filters').count(), 0);
  await page.screenshot({ path: `${OUT}/06-trash-empty.png` });
  await closeSheet();
});

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
assert.equal(errors.length, 0);
await context.close();
await browser.close();
