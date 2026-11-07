import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0].pages()[0];
const logs = [];
page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
page.on('pageerror', (error) => logs.push(`pageerror: ${error.stack || error.message}`));
page.on('requestfailed', (request) => logs.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  text: document.body.innerText.slice(0, 500),
  html: document.body.innerHTML.slice(0, 800),
  scripts: Array.from(document.scripts).map((script) => script.src || 'inline'),
  resources: performance.getEntriesByType('resource').map((entry) => entry.name),
  hasCapacitor: Boolean(window.Capacitor),
  stateExists: Boolean(localStorage.getItem('xinshi.state.v7')),
}));
console.log(JSON.stringify(info, null, 2));
console.log(logs.join('\n'));
await browser.close();
