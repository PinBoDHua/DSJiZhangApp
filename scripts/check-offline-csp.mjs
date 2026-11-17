#!/usr/bin/env node
/**
 * 构建产物离线 / CSP 校验（审计 R2：UI-11、UI-38、UI-40、AND-07）。
 * 用法：npx vite build && node scripts/check-offline-csp.mjs
 * 只读 dist/ 与 public/，失败时退出码 1。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
// 缓存版本期望值从 public/sw.js 动态读取：发版 bump SW 后无需再改本脚本。

let failures = 0;
const pass = (name, detail) => console.log('PASS  ' + name + (detail ? '：' + detail : ''));
const fail = (name, detail) => {
  failures += 1;
  console.error('FAIL  ' + name + (detail ? '：' + detail : ''));
};

const read = (path) => readFileSync(path, 'utf8');

/** dist 内全部文件的 POSIX 相对路径。 */
function listDist(dir = DIST, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) out.push(...listDist(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

if (!existsSync(join(DIST, 'index.html'))) {
  fail('dist 产物', 'dist/index.html 不存在，请先运行 npx vite build');
  process.exit(1);
}

const distFiles = listDist();
const has = (rel) => distFiles.includes(rel);

// ---- UI-11：预缓存清单 ----
let precache = [];
try {
  const manifest = JSON.parse(read(join(DIST, 'precache-manifest.json')));
  precache = Array.isArray(manifest.files) ? manifest.files.map(String) : [];
  if (precache.length === 0) fail('precache-manifest.json', 'files 为空');
  else pass('precache-manifest.json 存在', precache.length + ' 项');
} catch (error) {
  fail('precache-manifest.json', '读取失败：' + (error instanceof Error ? error.message : String(error)));
}

const precacheSet = new Set(precache);
const toRel = (url) => url.replace(/^\//, '');
const required = ['index.html', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const missingRequired = required.filter((rel) => !precacheSet.has('/' + rel));
if (missingRequired.length === 0) pass('预缓存含入口与图标', required.join('、'));
else fail('预缓存含入口与图标', '缺少 ' + missingRequired.join('、'));

const assetJs = distFiles.filter((f) => f.startsWith('assets/') && f.endsWith('.js'));
const assetCss = distFiles.filter((f) => f.startsWith('assets/') && f.endsWith('.css'));
const missingAssets = [...assetJs, ...assetCss].filter((rel) => !precacheSet.has('/' + rel));
if (missingAssets.length === 0) pass('预缓存含全部 assets chunk', assetJs.length + ' 个 js + ' + assetCss.length + ' 个 css');
else fail('预缓存含全部 assets chunk', '缺少 ' + missingAssets.slice(0, 8).join('、'));

const missingOnDisk = precache.filter((url) => !has(toRel(url)));
if (precache.length > 0 && missingOnDisk.length === 0) pass('预缓存清单全部文件存在', '0 个缺失');
else if (missingOnDisk.length > 0) fail('预缓存清单全部文件存在', 'dist 中不存在 ' + missingOnDisk.slice(0, 8).join('、'));

const selfCached = precache.filter((url) => /\/(sw|precache-manifest)\.(js|json)$/.test(url));
if (selfCached.length === 0) pass('预缓存不含 sw.js / 清单自身');
else fail('预缓存不含 sw.js / 清单自身', selfCached.join('、'));

// ---- UI-38 + CACHE_NAME ----
const swSource = read(join(DIST, 'sw.js'));
const swPublic = read(join(ROOT, 'public/sw.js'));
const swMatch = swSource.match(/const CACHE_NAME = '(xinshi-v([0-9]+))'/);
const publicMatch = swPublic.match(/const CACHE_NAME = '(xinshi-v([0-9]+))'/);
const expectedSw = publicMatch ? publicMatch[1] : null;
if (swMatch && expectedSw && swMatch[1] === expectedSw) pass('dist/sw.js 缓存版本', swMatch[1]);
else fail('dist/sw.js 缓存版本', '期望 ' + (expectedSw ?? '未找到') + '，实际 ' + (swMatch ? swMatch[1] : '未找到'));
if (publicMatch) pass('public/sw.js 缓存版本', publicMatch[1]);
else fail('public/sw.js 缓存版本', '未找到 CACHE_NAME 声明');
if (swSource.includes('precache-manifest.json') && swSource.includes('addAll')) pass('dist/sw.js 安装时读取预缓存清单');
else fail('dist/sw.js 安装时读取预缓存清单', '未找到清单 fetch / addAll');
const scoped = swSource.includes('/^xinshi-v\\d+$/.test(key)') &&
  swSource.includes('versions.filter((key) => !keep.has(key))') &&
  !swSource.includes('keys.filter((key) => !keep.has(key))');
if (scoped) pass('dist/sw.js activate 只清理薪时缓存');
else fail('dist/sw.js activate 只清理薪时缓存', '仍可能删除同源其他应用缓存');

// ---- UI-40 ----
try {
  const webmanifest = JSON.parse(read(join(DIST, 'manifest.webmanifest')));
  if (webmanifest.id === '/') pass('dist/manifest.webmanifest 有 id', '/');
  else fail('dist/manifest.webmanifest 有 id', '实际 ' + JSON.stringify(webmanifest.id === undefined ? null : webmanifest.id));
} catch (error) {
  fail('dist/manifest.webmanifest 可解析', error instanceof Error ? error.message : String(error));
}

// ---- AND-07：CSP meta 与内联脚本 hash ----
const html = read(join(DIST, 'index.html'));
const cspMatch = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i);
const inlinePattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const inlineScripts = [...html.matchAll(inlinePattern)].map((m) => m[1]);
if (!cspMatch) {
  fail('dist/index.html 含 CSP meta', '未找到 Content-Security-Policy');
} else {
  const policy = cspMatch[1];
  pass('dist/index.html 含 CSP meta');
  const needed = ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'object-src', 'base-uri', 'form-action', 'manifest-src'];
  const missingDirectives = needed.filter((d) => !new RegExp('(^|;\\s*)' + d + '\\b').test(policy));
  if (missingDirectives.length === 0) pass('CSP 指令齐全', needed.join(' '));
  else fail('CSP 指令齐全', '缺少 ' + missingDirectives.join('、'));
  const scriptSrcSegment = policy.slice(policy.indexOf('script-src'), policy.indexOf(';', policy.indexOf('script-src')));
  if (scriptSrcSegment.includes("'unsafe-inline'")) fail('CSP script-src 不含 unsafe-inline');
  else pass('CSP script-src 不含 unsafe-inline');
  const cspHashes = new Set([...policy.matchAll(/'sha256-([A-Za-z0-9+/=]+)'/g)].map((m) => m[1]));
  if (cspHashes.size > 0) pass('CSP 含内联脚本 sha256', cspHashes.size + ' 个');
  else fail('CSP 含内联脚本 sha256', '未找到 sha256 hash');
  if (inlineScripts.length === 0) {
    fail('dist/index.html 内联主题脚本', '未找到内联脚本');
  } else {
    const computed = inlineScripts.map((s) => createHash('sha256').update(s, 'utf8').digest('base64'));
    const mismatch = computed.filter((hash) => !cspHashes.has(hash));
    if (mismatch.length === 0) pass('CSP sha256 与被包内联脚本一致', inlineScripts.length + ' 条内联脚本');
    else fail('CSP sha256 与被包内联脚本一致', mismatch.length + ' 条 hash 不匹配：' + mismatch.join('、'));
  }
  const cspAt = html.indexOf('Content-Security-Policy');
  const scriptAt = html.search(/<script(?![^>]*\bsrc=)/i);
  if (cspAt >= 0 && scriptAt >= 0 && cspAt < scriptAt) pass('CSP meta 位于内联脚本之前');
  else fail('CSP meta 位于内联脚本之前', 'CSP 注入位置晚于内联脚本，浏览器不会拦截它');
}

if (failures > 0) {
  console.error('\n构建产物校验失败：' + failures + ' 项');
  process.exit(1);
}
console.log('\n构建产物校验通过（离线预缓存 + CSP + manifest id）');
