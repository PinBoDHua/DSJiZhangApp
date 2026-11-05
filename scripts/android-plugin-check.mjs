import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];
const info = await page.evaluate(() => {
  const capacitor = window.Capacitor;
  return {
    type: typeof capacitor,
    keys: capacitor ? Object.keys(capacitor) : [],
    plugins: capacitor && capacitor.Plugins ? Object.keys(capacitor.Plugins) : null,
  };
});
console.log(JSON.stringify(info, null, 2));

if (info.plugins && info.plugins.includes('SaveFile')) {
  const result = await page.evaluate(async () => {
    const plugin = window.Capacitor.Plugins.SaveFile;
    const out = [];
    for (let index = 0; index < 5; index += 1) {
      const filename = `测试自动备份-${String(index).padStart(2, '0')}.json`;
      out.push(
        await plugin.save({
          filename,
          mimeType: 'application/json',
          data: btoa('{"test":true}'),
          overwrite: true,
          subdir: '测试',
        }),
      );
    }
    const pruned = await plugin.prune({ prefix: '测试自动备份-', keep: 2, subdir: '测试' });
    await plugin.save({
      filename: '测试覆盖.json',
      mimeType: 'application/json',
      data: btoa('{"version":1}'),
      overwrite: true,
      subdir: '测试',
    });
    await plugin.save({
      filename: '测试覆盖.json',
      mimeType: 'application/json',
      data: btoa('{"version":2}'),
      overwrite: true,
      subdir: '测试',
    });
    return { out: out.length, pruned };
  });
  console.log('plugin calls:', JSON.stringify(result));
}

await browser.close();
