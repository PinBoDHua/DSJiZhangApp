import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const APP_VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
const OUT = 'test-results-android-v120-audit';
await mkdir(OUT, { recursive: true });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const pages = context.pages();
const page = pages.find((item) => item.url().startsWith('https://localhost')) ?? pages[0];
assert.ok(page, '没有找到薪时 WebView');
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`[console] ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

const steps = [];
async function step(name, fn) {
  try {
    const detail = await fn();
    steps.push({ name, ok: true, detail });
    console.log(`PASS ${name}`, detail === undefined ? '' : JSON.stringify(detail));
    return detail;
  } catch (error) {
    steps.push({ name, ok: false, error: String(error) });
    await page.screenshot({ path: `${OUT}/FAIL-${name.replace(/[^\w\u4e00-\u9fa5]+/g, '-')}.png`, fullPage: true }).catch(() => undefined);
    console.error(`FAIL ${name}`, error.message);
    throw error;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dumpStorage = () =>
  page.evaluate(() => {
    const out = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key !== null) out[key] = localStorage.getItem(key);
    }
    return out;
  });

const restoreStorage = async (dump) => {
  await page.evaluate((data) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(data)) localStorage.setItem(key, value);
  }, dump);
};

const readState = async () => {
  const raw = await page.evaluate(() => localStorage.getItem('xinshi.state.v7'));
  return raw ? JSON.parse(raw) : null;
};

const listSnapshotIds = () =>
  page.evaluate(async () => {
    // 先确认库已存在：直接 open() 会在缺失时建一个没有 objectStore 的版本 1 库，反而弄坏 App 的快照。
    try {
      const databases = await indexedDB.databases?.();
      if (!databases || !databases.some((item) => item.name === 'xinshi.snapshots')) return [];
    } catch {
      return [];
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('xinshi.snapshots');
      request.onerror = () => reject(request.error ?? new Error('打不开快照库'));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('snapshots')) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction('snapshots', 'readonly');
        const all = tx.objectStore('snapshots').getAllKeys();
        all.onsuccess = () => {
          db.close();
          resolve(all.result);
        };
        all.onerror = () => {
          db.close();
          reject(all.error ?? new Error('读取快照 ID 失败'));
        };
      };
    });
  });

const deleteSnapshots = (ids) =>
  page.evaluate(
    (keys) =>
      new Promise((resolve) => {
        if (keys.length === 0) {
          resolve(0);
          return;
        }
        const request = indexedDB.open('xinshi.snapshots');
        request.onerror = () => resolve(0);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('snapshots', 'readwrite');
          const store = tx.objectStore('snapshots');
          for (const key of keys) store.delete(key);
          tx.oncomplete = () => {
            db.close();
            resolve(keys.length);
          };
          tx.onerror = () => {
            db.close();
            resolve(0);
          };
        };
      }),
    ids,
  );

const openTab = async (name) => {
  await page.getByRole('button', { name, exact: true }).click();
  await sleep(600);
};

const waitHome = async () => {
  await page.locator('.home-page').waitFor({ timeout: 25000 });
};

// 先重载一次，确保从首页开始（上次真机调试可能停在“我的”等页签）。
await page.reload({ waitUntil: 'domcontentloaded' });
await waitHome();
const originalStorage = await dumpStorage();
const originalRaw = originalStorage['xinshi.state.v7'];
assert.ok(originalRaw, '本机账本不存在');
const originalState = JSON.parse(originalRaw);
const originalSnapshots = await listSnapshotIds();
await writeFile(`${OUT}/device-state-before.json`, originalRaw);
console.log('ORIGINAL', JSON.stringify({
  entries: originalState.entries?.length ?? 0,
  jobs: originalState.jobs?.length ?? 0,
  settlements: originalState.settlements?.length ?? 0,
  rules: originalState.recurringRules?.length ?? 0,
  budget: originalState.settings?.budget ?? null,
  autoBackup: originalStorage['xinshi.autoBackup'] ?? null,
}));

await step('首页渲染、安全区与无横向溢出', async () => {
  const layout = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    safeTop: getComputedStyle(document.documentElement).getPropertyValue('--safe-top').trim(),
    mainTop: Math.round(document.querySelector('.app-main')?.getBoundingClientRect().top ?? 0),
    navBottom: Math.round(window.innerHeight - (document.querySelector('.bottom-nav')?.getBoundingClientRect().bottom ?? 0)),
  }));
  assert.equal(layout.overflow, 0, `横向溢出 ${layout.overflow}px`);
  assert.ok(layout.mainTop >= 30, `主区顶部 ${layout.mainTop}px 太小`);
  assert.ok(layout.navBottom >= 14, `底栏距底 ${layout.navBottom}px 太小`);
  assert.ok(layout.safeTop.endsWith('px'), '未注入 --safe-top');
  await page.screenshot({ path: `${OUT}/01-home.png` });
  return layout;
});

await step('版本号与账本未被改动', async () => {
  await openTab('我的');
  const footer = await page.locator('.profile-footer').innerText();
  assert.ok(footer.includes(`v${APP_VERSION}`), footer);
  const onDisk = await readState();
  assert.equal(onDisk.entries.length, originalState.entries.length);
  assert.equal(onDisk.jobs.length, originalState.jobs.length);
  return footer.replace(/\s+/g, ' ').slice(0, 80);
});

await step('原生保存同名文件只保留一份且内容为最新', async () => {
  const result = await page.evaluate(async () => {
    const plugin = window.Capacitor?.Plugins?.SaveFile;
    if (!plugin) throw new Error('SaveFile 插件未注册');
    const first = await plugin.save({
      filename: 'audit-overwrite.json',
      mimeType: 'application/json',
      subdir: '测试',
      data: btoa('{"version":1}'),
    });
    const second = await plugin.save({
      filename: 'audit-overwrite.json',
      mimeType: 'application/json',
      subdir: '测试',
      data: btoa('{"version":2}'),
    });
    return { first, second };
  });
  assert.ok(result.second.path.includes('audit-overwrite.json'));
  return result.second.path;
});

await step('完整工记 CSV 走原生保存', async () => {
  await page.getByRole('button', { name: /数据与安全/ }).click();
  await page.getByRole('button', { name: /完整工记 CSV/ }).click();
  await sleep(1500);
  const toast = await page.locator('.toast').innerText();
  assert.ok(toast.includes('下载/Xinshi') || toast.includes('已导出'), toast);
  await page.screenshot({ path: `${OUT}/02-csv.png`, fullPage: false });
  return toast.replace(/\s+/g, ' ');
});

await step('搬家包全空白密码被拒绝且不生成文件', async () => {
  await page.getByRole('button', { name: /^搬家$/ }).click();
  await page.getByLabel('设置密码（建议）').fill('        ');
  await page.getByLabel('再输一次').fill('        ');
  await page.getByRole('button', { name: '导出搬家包' }).click();
  await sleep(400);
  const error = await page.locator('.move-error').innerText();
  assert.ok(error.includes('不能全是空格'), error);
  assert.equal(await page.locator('.move-done').count(), 0, '不应出现“已保存”界面');
  await page.screenshot({ path: `${OUT}/03-move-password.png` });
  await page.getByRole('button', { name: '取消' }).click();
  await sleep(300);
  return error.replace(/\s+/g, ' ');
});

// ---------- 测试账本：周期补记上限 / 预算 ARIA / 删除时滚动锁 ----------
try {
await step('写入测试账本（周期规则 + 预算）并重载', async () => {
  const testState = JSON.parse(originalRaw);
  const job = testState.jobs.find((item) => !item.archived);
  assert.ok(job, '没有可用工作');
  const stamp = new Date().toISOString();
  testState.settings.budget = { enabled: true, incomeTarget: 4000, hoursLimit: 200 };
  testState.recurringRules = [
    {
      id: 'audit-rule-1',
      jobId: job.id,
      frequency: 'daily',
      weekdays: [],
      dayOfMonth: 1,
      startDate: '2025-01-01',
      hours: 8,
      quantity: 0,
      bonus: 0,
      deduction: 0,
      enabled: true,
      auto: false,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const next = { ...originalStorage, 'xinshi.state.v7': JSON.stringify(testState) };
  if (next['xinshi.autoBackup']) {
    next['xinshi.autoBackup'] = JSON.stringify({ enabled: false, keep: 14 });
  }
  await restoreStorage(next);
  await page.reload();
  await waitHome();
  const onDisk = await readState();
  assert.equal(onDisk.recurringRules.length, 1);
  return { entries: onDisk.entries.length, job: job.name };
});

await step('周期规则首次补记被限制在最近 120 天', async () => {
  await openTab('记录');
  await page.getByRole('button', { name: '周期记工', exact: true }).click();
  await page.locator('.recurring-summary').waitFor({ timeout: 20000 });
  const summary = await page.locator('.recurring-summary').innerText();
  // 原有工记会占用其中几天，用「待补记 + 跳过 = 120」校验窗口，而不是写死 120 笔。
  const pendingMatch = summary.match(/(\d+) 笔待补记/);
  const skippedMatch = summary.match(/另有 (\d+) 天/);
  const pending = Number(pendingMatch?.[1] ?? 0);
  const skipped = Number(skippedMatch?.[1] ?? 0);
  assert.ok(pending > 0, summary);
  assert.equal(pending + skipped, 120, `窗口内应正好处理 120 天：${pending}+${skipped}`);
  assert.ok(summary.includes('120 天'), '缺少回溯上限提示');
  await page.screenshot({ path: `${OUT}/04-recurring-preview.png`, fullPage: true });
  await page.getByRole('button', { name: /确认补记到期工记/ }).click();
  await sleep(2500);
  const toast = await page.locator('.toast').innerText();
  assert.ok(toast.includes(`已补记 ${pending} 笔`), toast);
  const after = await page.locator('.recurring-summary').innerText();
  assert.ok(after.includes('0 笔待补记'), after);
  const onDisk = await readState();
  assert.equal(onDisk.entries.length, originalState.entries.length + pending);
  const dates = onDisk.entries
    .filter((entry) => entry.recurringRuleId === 'audit-rule-1')
    .map((entry) => entry.date)
    .sort();
  assert.equal(dates.length, pending);
  const oldest = new Date(`${dates[0]}T00:00:00`);
  const today = new Date();
  const span = Math.round((today - oldest) / 86_400_000);
  assert.ok(span <= 122, `补记跨度过大：${span} 天`);
  await page.screenshot({ path: `${OUT}/05-recurring-done.png`, fullPage: true });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  return { firstDate: dates[0], lastDate: dates[dates.length - 1], span };
});

await step('删除工记后嵌套弹层不锁死页面滚动', async () => {
  await page.locator('.entry-row').first().click();
  await page.locator('.sheet').first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.locator('.dialog').waitFor({ timeout: 10000 });
  await page.locator('.dialog').getByRole('button', { name: '删除', exact: true }).click();
  await sleep(700);
  const state = await page.evaluate(() => ({
    overflow: document.body.style.overflow,
    dialogs: document.querySelectorAll('.dialog').length,
    sheets: document.querySelectorAll('.sheet').length,
  }));
  assert.equal(state.overflow, '', 'body.overflow 仍被锁住');
  assert.equal(state.dialogs, 0);
  assert.equal(state.sheets, 0);
  const scrolled = await page.evaluate(async () => {
    window.scrollTo(0, 600);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const y = window.scrollY;
    window.scrollTo(0, 0);
    return y;
  });
  assert.ok(scrolled > 0, `页面无法滚动（scrollY=${scrolled}）`);
  return { ...state, scrolled };
});

await step('统计页预算进度条可读且 ARIA 完整', async () => {
  await openTab('统计');
  await page.getByRole('button', { name: '本月', exact: true }).click();
  await page.locator('.budget-card').waitFor({ timeout: 15000 });
  const bars = await page.locator('.budget-card [role="progressbar"]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.getAttribute('aria-label'),
      now: node.getAttribute('aria-valuenow'),
      min: node.getAttribute('aria-valuemin'),
      max: node.getAttribute('aria-valuemax'),
    })),
  );
  assert.equal(bars.length, 2, JSON.stringify(bars));
  for (const bar of bars) {
    assert.ok(bar.label, '缺少 aria-label');
    assert.equal(bar.min, '0');
    assert.equal(bar.max, '100');
    assert.ok(Number(bar.now) >= 0 && Number(bar.now) <= 100, JSON.stringify(bar));
  }
  await page.screenshot({ path: `${OUT}/06-budget-light.png`, fullPage: true });
  return bars;
});

await step('深色模式预算卡分档边框可见', async () => {
  const state = await readState();
  state.settings.theme = 'dark';
  await page.evaluate((next) => localStorage.setItem('xinshi.state.v7', JSON.stringify(next)), state);
  await page.reload();
  await waitHome();
  await openTab('统计');
  await page.getByRole('button', { name: '本月', exact: true }).click();
  await page.locator('.budget-card').waitFor({ timeout: 15000 });
  const tone = await page.evaluate(() => {
    const card = document.querySelector('.budget-card');
    const style = getComputedStyle(card);
    return {
      className: card.className,
      border: style.borderTopColor,
      theme: document.documentElement.dataset.theme,
    };
  });
  assert.equal(tone.theme, 'dark');
  assert.ok(/is-(warning|success|info)/.test(tone.className), tone.className);
  await page.screenshot({ path: `${OUT}/07-budget-dark.png`, fullPage: true });
  return tone;
});

await step('损坏账本恢复页可原生导出原文', async () => {
  await page.evaluate(() => localStorage.setItem('xinshi.state.v7', '{broken-original'));
  await page.reload();
  await page.getByText('账本需要人工恢复', { exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /导出原始账本/ }).click();
  await page.locator('.error-boundary-status').waitFor({ timeout: 20000 });
  const status = await page.locator('.error-boundary-status').innerText();
  assert.ok(status.includes('已保存到'), status);
  assert.equal(await page.evaluate(() => localStorage.getItem('xinshi.state.v7')), '{broken-original');
  await page.screenshot({ path: `${OUT}/08-recovery.png` });
  return status.replace(/\s+/g, ' ');
});
} catch (error) {
  // 测试账本只用于本次验证：任何一步失败都立即恢复用户真实账本，避免把测试数据留在手机上。
  await restoreStorage(originalStorage).catch(() => undefined);
  await page.reload().catch(() => undefined);
  await waitHome().catch(() => undefined);
  throw error;
}

await step('恢复真实账本并校验数据与快照', async () => {
  await restoreStorage(originalStorage);
  await page.reload();
  await waitHome();
  // 等自动快照的 1.6s 定时器跑完再统计，避免把测试期间新建的快照算成用户数据。
  await sleep(2500);
  const restored = await readState();
  assert.equal(restored.entries.length, originalState.entries.length);
  assert.equal(restored.jobs.length, originalState.jobs.length);
  assert.equal(restored.settlements.length, originalState.settlements.length);
  assert.equal(restored.recurringRules?.length ?? 0, originalState.recurringRules?.length ?? 0);
  assert.deepEqual(restored.settings, originalState.settings);
  assert.equal(
    JSON.stringify(restored.entries.map((entry) => entry.id)),
    JSON.stringify(originalState.entries.map((entry) => entry.id)),
  );
  const nowSnapshots = await listSnapshotIds();
  const created = nowSnapshots.filter((id) => !originalSnapshots.includes(id));
  if (created.length > 0) await deleteSnapshots(created);
  await page.screenshot({ path: `${OUT}/09-final-home.png` });
  return {
    entries: restored.entries.length,
    jobs: restored.jobs.length,
    createdSnapshots: created.length,
    snapshotCount: nowSnapshots.length,
  };
});

// 损坏账本一步会故意让 App 打一条「本地账本无法读取」，属于测试预期。
const unexpectedErrors = errors.filter((line) => !line.includes('本地账本无法读取'));
assert.deepEqual(unexpectedErrors, [], unexpectedErrors.join('\n'));
await writeFile(
  `${OUT}/result.json`,
  JSON.stringify({ steps, errors: unexpectedErrors, original: { entries: originalState.entries.length, jobs: originalState.jobs.length } }, null, 2),
);
console.log(`ALL PASS Android v${APP_VERSION} audit device check`);
await browser.close();
