#!/usr/bin/env node
/**
 * 薪时发布前配置检查（只读，零依赖，仅使用 Node 原生 API）。
 * 用法：node scripts/check-release-config.mjs
 * 任一硬性检查失败时进程退出码为 1；本脚本不会修改、创建或删除任何文件。
 *
 * 环境变量：
 *   XINSHI_RELEASE_STRICT=1  把「产物缺失」等人工确认项升级为 FAIL（默认仅 NOTE）。
 *   SKIP_APK_CHECK=1         无 Android SDK 时显式跳过 aapt2 / apksigner 产物断言（会打印 NOTE 说明跳过原因）。
 *
 * 覆盖范围（对应审计 AND-03/04/05/14、D01–D06）：
 *   版本号一致性 + versionCode 公式碰撞提示、SW 缓存版本、
 *   隐私政策 URL / 离线页 / 两份逐字节一致 / 内部链接与占位邮箱 / 占位域名 / 版本号同步、
 *   敏感文件与 .gitignore、FileProvider 白名单、release 签名守卫与 debuggable / diag release 守卫、
 *   release APK 的 aapt2 badging 断言（debuggable / versionCode / versionName）、
 *   apksigner 证书指纹、dist ↔ assets/public 逐文件 sha256、dist/index.html 的 CSP meta。
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.env.XINSHI_RELEASE_STRICT === '1';
/** 无 Android SDK 的环境显式跳过产物级断言；跳过原因会打印 NOTE（不再静默降级）。 */
const SKIP_APK_CHECK = process.env.SKIP_APK_CHECK === '1';
const results = [];

/** 占位域名：出现在隐私政策 URL / .env.example 里一律视为上架阻断（D06）。 */
const PLACEHOLDER_DOMAINS = ['example.com', 'example.org', 'example.net'];
/** 占位值：上架前必须替换为真实可收信邮箱。 */
const PLACEHOLDER_EMAILS = ['support@xinshi.app', 'you@example.com', ...PLACEHOLDER_DOMAINS];
/** 发布登记的签名证书 SHA-256（见 docs/RELEASE-NOTES-v<version>.md；比较时统一小写）。 */
const EXPECTED_SIGNER_SHA256 = 'a5b8514a165a7849a4073bd00a94759fcb957aa02f83970012eb72f25185d606';
/** assets/public 侧允许比 dist 多出的 Capacitor 生成文件（D04 白名单）。 */
const ASSETS_ONLY_FILES = ['cordova.js', 'cordova_plugins.js'];
/** 政策页允许保留的外部链接白名单（空数组 = 不允许外部链接，避免再出现死链）。 */
const ALLOWED_POLICY_LINKS = [];
/** release 产物任务集合（与 build.gradle 的守卫保持一致）。 */
const RELEASE_ARTIFACT_TASKS = [
  'assembleRelease',
  'bundleRelease',
  'installRelease',
  'packageRelease',
  'packageReleaseBundle',
];

/** @param {string} title @param {string} [detail] */
function pass(title, detail = '') {
  results.push(true);
  console.log('PASS  ' + title + (detail ? ' —— ' + detail : ''));
}

/** @param {string} title @param {string} [detail] */
function fail(title, detail = '') {
  results.push(false);
  console.log('FAIL  ' + title + (detail ? ' —— ' + detail : ''));
}

/** @param {string} message */
function note(message) {
  console.log('NOTE  ' + message);
}

/** @param {string} message */
function warn(message) {
  console.log('WARN  ' + message);
}

/** 严格模式 FAIL、默认 NOTE：用于需要人工确认但不应阻断本地检查的项。 */
function failInStrict(title, detail) {
  if (STRICT) {
    fail(title, detail);
  } else {
    note(title + '：' + detail + '（XINSHI_RELEASE_STRICT=1 时 FAIL）');
  }
}

/** @param {string} relativePath */
function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

/** @param {string[]} args */
function runGit(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** 判断一个 git 跟踪路径是否属于敏感文件（密钥 / 口令 / 本地环境）。 */
function isSensitivePath(trackedPath) {
  const base = trackedPath.split('/').pop() ?? '';
  if (trackedPath.startsWith('android/keystore/')) return true;
  if (/\.(jks|keystore|pem|p12|p8|key)$/i.test(trackedPath)) return true;
  if (base === 'google-services.json') return true;
  if (base === 'signing.properties' || base === 'password.txt') return true;
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return true;
  return false;
}

/** 扫描政策 HTML 内的超链接：相对链接必须存在，外部链接必须在白名单内。 */
function scanPolicyLinks(relativePath) {
  const html = read(relativePath);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  const broken = [];
  const placeholderEmails = [];
  for (const link of links) {
    if (link.startsWith('#')) continue;
    if (link.toLowerCase().startsWith('mailto:')) {
      const email = link.slice('mailto:'.length).split('?')[0].trim();
      if (PLACEHOLDER_EMAILS.some((item) => email.toLowerCase().includes(item.toLowerCase()))) {
        placeholderEmails.push(email);
      }
      continue;
    }
    if (/^https?:\/\//i.test(link)) {
      if (!ALLOWED_POLICY_LINKS.includes(link)) broken.push(link);
      continue;
    }
    const target = join(ROOT, dirname(relativePath), link.split('#')[0].split('?')[0]);
    if (!existsSync(target)) broken.push(link);
  }
  return { links, broken, placeholderEmails };
}

/** 判断字符串是否含 example.com / example.org / example.net 占位域名（D06）。 */
function containsPlaceholderDomain(value) {
  const lower = String(value).toLowerCase();
  return PLACEHOLDER_DOMAINS.some((domain) => lower.includes(domain));
}

/** 递归收集目录下每个文件的 sha256（相对路径统一用 /，用于 D04 的 dist ↔ assets 比对）。 */
function hashTree(rootDir) {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const key = relative(rootDir, fullPath).split(sep).join('/');
        files[key] = createHash('sha256').update(readFileSync(fullPath)).digest('hex');
      }
    }
  };
  walk(rootDir);
  return files;
}

/** 从 release/ 的 APK 文件名中取语义化版本号最高者（解析不了时回退最新 mtime，D03）。 */
function pickLatestVersionApk(apkNames, releaseDir) {
  const parsed = apkNames
    .map((name) => {
      const match = /^xinshi-v(\d+)\.(\d+)\.(\d+)\.apk$/i.exec(name);
      return match
        ? { name, parts: [Number(match[1]), Number(match[2]), Number(match[3])] }
        : null;
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.parts[0] - a.parts[0] || b.parts[1] - a.parts[1] || b.parts[2] - a.parts[2],
    );
  if (parsed.length > 0) return parsed[0].name;
  return apkNames
    .map((name) => ({ name, mtime: statSync(join(releaseDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].name;
}

/** 读取 android/local.properties 的 sdk.dir（缺失或无法读取时返回 null，D02）。 */
function readLocalSdkDir() {
  const propertiesFile = join(ROOT, 'android/local.properties');
  if (!existsSync(propertiesFile)) return null;
  try {
    const match = readFileSync(propertiesFile, 'utf8').match(/^\s*sdk\.dir\s*=\s*(.+?)\s*$/m);
    return match ? match[1].replace(/\\\\/g, '\\').replace(/^"|"$/g, '') : null;
  } catch {
    return null;
  }
}

/**
 * 候选 SDK 目录（D02）：ANDROID_HOME → ANDROID_SDK_ROOT → android/local.properties 的 sdk.dir
 * → 常见安装路径（Windows %LOCALAPPDATA%\Android\Sdk 等）。去重并只保留真实存在的目录。
 */
function sdkCandidates() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    readLocalSdkDir(),
  ];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
    candidates.push('C:/Android/Sdk');
  } else if (process.platform === 'darwin') {
    candidates.push(join(process.env.HOME || '', 'Library', 'Android', 'sdk'));
  } else {
    candidates.push(join(process.env.HOME || '', 'Android', 'Sdk'), '/usr/lib/android-sdk');
  }
  return [...new Set(candidates.filter((item) => item && existsSync(item)))];
}

/** 在某个 SDK 的 build-tools（版本倒序）中查找指定工具。 */
function findBuildTool(sdkDir, fileNames) {
  const buildTools = join(sdkDir, 'build-tools');
  if (!existsSync(buildTools)) return null;
  let versions = [];
  try {
    versions = readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return null;
  }
  for (const version of versions) {
    for (const name of fileNames) {
      const candidate = join(buildTools, version, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** 查找 aapt2（D02）：不再只认环境变量，找不到时由调用方 FAIL 或按 SKIP_APK_CHECK 跳过。 */
function findAapt2() {
  for (const sdkDir of sdkCandidates()) {
    const tool = findBuildTool(sdkDir, ['aapt2.exe', 'aapt2']);
    if (tool) return tool;
  }
  return null;
}

/** 查找 apksigner（D03）：Windows 下为 apksigner.bat。 */
function findApksigner() {
  for (const sdkDir of sdkCandidates()) {
    const tool = findBuildTool(sdkDir, ['apksigner.bat', 'apksigner']);
    if (tool) return tool;
  }
  return null;
}

/** 执行外部工具；Windows 的 .bat / .cmd 需要经 cmd.exe 启动。 */
function runTool(toolPath, args) {
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(toolPath)) {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', toolPath, ...args], options);
  }
  return execFileSync(toolPath, args, options);
}

console.log('薪时发布配置检查（只读，不修改任何文件）');
console.log('');

// 1. package.json version 与 android/app/build.gradle 默认 versionCode / versionName
try {
  const pkg = JSON.parse(read('package.json'));
  const version = String(pkg.version ?? '');
  const gradle = read('android/app/build.gradle');
  const nameMatch = gradle.match(/def xinshiVersionName[\s\S]*?:\s*"([^"]+)"/);
  const codeMatch = gradle.match(/def xinshiVersionCode[\s\S]*?:\s*(\d+)/);
  const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  if (!semver) {
    fail('package.json 版本号可解析', '当前值 "' + version + '" 不是 x.y.z');
  } else {
    const expectedVersionCode =
      Number(semver[1]) * 1000 + Number(semver[2]) * 100 + Number(semver[3]);

    if (!nameMatch) {
      fail('build.gradle 默认 versionName 可解析');
    } else if (nameMatch[1] !== version) {
      fail('versionName 与 package.json 一致', 'build.gradle="' + nameMatch[1] + '"，package.json="' + version + '"');
    } else {
      pass('versionName 与 package.json 一致', version);
    }

    if (!codeMatch) {
      fail('build.gradle 默认 versionCode 可解析');
    } else if (Number(codeMatch[1]) !== expectedVersionCode) {
      fail(
        'versionCode 与语义化版本对应',
        'build.gradle=' + codeMatch[1] + '，按 ' + version + ' 应为 ' + expectedVersionCode,
      );
    } else {
      pass('versionCode 与语义化版本对应', version + ' → ' + expectedVersionCode);
    }

    // AND-05：major*1000+minor*100+patch 在 minor>=10 / patch>=100 时会碰撞（1.10.0 与 2.0.0 同为 2000）。
    if (Number(semver[2]) >= 10 || Number(semver[3]) >= 100) {
      warn(
        'versionCode 公式碰撞提示：' + version + ' → ' + expectedVersionCode +
          '；minor>=10 或 patch>=100 时公式会与更高主版本冲突，请改用单调递增策略',
      );
    }
  }
} catch (error) {
  fail('版本号一致性检查', error instanceof Error ? error.message : String(error));
}

// 2. public/sw.js 的 CACHE_NAME 版本（格式 + 相对上一提交不回退）
try {
  const sw = read('public/sw.js');
  const match = sw.match(/const CACHE_NAME = 'xinshi-v(\d+)'/);
  if (!match) {
    fail('public/sw.js CACHE_NAME 格式', "未找到 const CACHE_NAME = 'xinshi-vN'");
  } else {
    const current = Number(match[1]);
    pass('public/sw.js CACHE_NAME 格式有效', 'xinshi-v' + current);

    try {
      const previousSource = runGit(['show', 'HEAD~1:public/sw.js']);
      const previous = previousSource.match(/const CACHE_NAME = 'xinshi-v(\d+)'/);
      if (!previous) {
        note('无法从上一提交解析 CACHE_NAME，跳过版本递增检查');
      } else if (Number(previous[1]) > current) {
        fail('SW 缓存版本未回退', '上一提交 v' + previous[1] + '，当前 v' + current);
      } else if (Number(previous[1]) === current) {
        note('SW 缓存版本与上一提交同为 v' + current + '：若本次发布包含 Web 资源变更，请在发布提交中确认已 bump');
      } else {
        pass('SW 缓存版本较上一提交递增', 'v' + previous[1] + ' → v' + current);
      }
    } catch {
      note('无法读取上一提交的 public/sw.js（浅克隆或无 git），跳过版本递增检查');
    }
  }
} catch (error) {
  fail('public/sw.js 检查', error instanceof Error ? error.message : String(error));
}

// 3. 隐私政策：默认地址、离线页、两份逐字节一致、内部链接、占位邮箱、PRIVACY_VERSION 同步
const OFFLINE_PAGE = 'public/privacy-policy.html';
const STORED_PAGE = 'docs/privacy-policy.html';
let policyHtml = '';
try {
  const compliance = read('src/lib/compliance.ts');
  const urlMatch = compliance.match(/VITE_PRIVACY_URL\s*\|\|\s*'([^']+)'/);
  if (!urlMatch) {
    fail('compliance.ts 中 PRIVACY_URL 默认值可解析');
  } else {
    const value = urlMatch[1];
    if (/pinbodhua\.github\.io/i.test(value)) {
      fail('PRIVACY_URL 默认值指向已失效地址', value);
    } else if (containsPlaceholderDomain(value)) {
      fail(
        'PRIVACY_URL 默认值不是占位域名',
        value + ' 含 example.com 一类占位域名，构建后会被编进 App，商店审核会判「隐私政策链接不可用」',
      );
    } else if (/^https?:\/\//i.test(value)) {
      pass('PRIVACY_URL 默认值不是已失效地址', value);
      note('PRIVACY_URL 默认为外部地址，请人工确认在无登录状态下可公开访问（HTTPS 且实测 200）');
    } else if (!existsSync(join(ROOT, OFFLINE_PAGE))) {
      fail('PRIVACY_URL 使用相对路径但离线政策页缺失', OFFLINE_PAGE);
    } else {
      const bytes = statSync(join(ROOT, OFFLINE_PAGE)).size;
      pass('PRIVACY_URL 默认值指向离线政策页', value + '（' + OFFLINE_PAGE + ' 存在，' + bytes + ' 字节，构建后进入 dist/）');
    }
  }

  if (!existsSync(join(ROOT, OFFLINE_PAGE))) {
    fail('离线隐私政策页存在', OFFLINE_PAGE);
  } else if (!existsSync(join(ROOT, STORED_PAGE))) {
    fail('docs 隐私政策副本存在', STORED_PAGE);
  } else {
    policyHtml = read(OFFLINE_PAGE);
    const stored = read(STORED_PAGE);
    if (policyHtml !== stored) {
      fail('两份隐私政策逐字节一致', OFFLINE_PAGE + ' 与 ' + STORED_PAGE + ' 不一致，请同步更新离线副本');
    } else {
      pass('两份隐私政策逐字节一致', OFFLINE_PAGE + ' = ' + STORED_PAGE + '（' + policyHtml.length + ' 字符）');
    }
  }

  const placeholderEmails = [];
  for (const page of [OFFLINE_PAGE, STORED_PAGE]) {
    if (!existsSync(join(ROOT, page))) continue;
    const scan = scanPolicyLinks(page);
    if (scan.broken.length > 0) {
      fail('政策页内部链接有效', page + ' 存在死链 / 未托管外部链接：' + scan.broken.join(', '));
    } else {
      pass('政策页内部链接有效', page + '（' + scan.links.length + ' 个链接，无死链）');
    }
    placeholderEmails.push(...scan.placeholderEmails);
  }

  const emailMatch = compliance.match(/VITE_SUPPORT_EMAIL\s*\|\|\s*'([^']+)'/);
  if (emailMatch) {
    const email = emailMatch[1];
    if (PLACEHOLDER_EMAILS.some((item) => email.toLowerCase().includes(item.toLowerCase()))) {
      placeholderEmails.push(email);
    }
  }
  if (placeholderEmails.length > 0) {
    // D06：占位邮箱一律 FAIL（不再只在 STRICT 下拦截），避免占位值随构建进入正式包。
    fail(
      '支持邮箱不是占位值',
      '检测到占位邮箱 ' + [...new Set(placeholderEmails)].join(', ') + '；上架前必须换成真实可收信邮箱并同步政策 HTML',
    );
  } else {
    pass('支持邮箱不是占位值');
  }

  const versionMatch = compliance.match(/PRIVACY_VERSION\s*=\s*'([^']+)'/);
  if (!versionMatch) {
    fail('compliance.ts 中 PRIVACY_VERSION 可解析');
  } else {
    const version = versionMatch[1];
    const pages = [OFFLINE_PAGE, STORED_PAGE].filter((page) => existsSync(join(ROOT, page)));
    const unsynced = pages.filter((page) => !read(page).includes(version));
    if (pages.length === 0) {
      fail('政策页版本与 PRIVACY_VERSION 同步', '未找到政策 HTML');
    } else if (unsynced.length > 0) {
      fail('政策页版本与 PRIVACY_VERSION 同步', 'PRIVACY_VERSION=' + version + '，以下页面缺少该版本号：' + unsynced.join(', '));
    } else {
      pass('政策页版本与 PRIVACY_VERSION 同步', version);
    }
  }
} catch (error) {
  fail('隐私政策检查', error instanceof Error ? error.message : String(error));
}

// 3.1 .env.example / 构建环境变量的占位值兜底（D06）：模板被 cp 成 .env 后会被 Vite 自动加载。
try {
  const ENV_EXAMPLE = '.env.example';
  const offenders = [];
  if (existsSync(join(ROOT, ENV_EXAMPLE))) {
    const activeLines = read(ENV_EXAMPLE)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    for (const line of activeLines) {
      const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, value] = match;
      const placeholderEmail =
        key.toUpperCase().includes('EMAIL') &&
        PLACEHOLDER_EMAILS.some((item) => value.toLowerCase().includes(item.toLowerCase()));
      if (containsPlaceholderDomain(value) || placeholderEmail) {
        offenders.push(key + '=' + value);
      }
    }
    if (offenders.length > 0) {
      fail(
        '.env.example 不含占位域名 / 占位邮箱',
        '未注释的占位值：' + offenders.join(', ') + '；请注释或留空，构建前注入真实值',
      );
    } else {
      pass('.env.example 不含占位域名 / 占位邮箱', '已检查 ' + activeLines.length + ' 个未注释变量');
    }
  } else {
    note(ENV_EXAMPLE + ' 不存在，跳过占位值检查（模板应随仓库提供，便于注入真实隐私政策 URL / 邮箱）');
  }
  // 直接通过环境变量注入时同样拦截（VITE_ 前缀变量会覆盖 compliance.ts 默认值）。
  const envOffenders = ['VITE_PRIVACY_URL', 'VITE_SUPPORT_EMAIL']
    .filter((key) => process.env[key])
    .filter((key) => {
      const value = process.env[key] ?? '';
      return (
        containsPlaceholderDomain(value) ||
        (key === 'VITE_SUPPORT_EMAIL' &&
          PLACEHOLDER_EMAILS.some((item) => value.toLowerCase().includes(item.toLowerCase())))
      );
    })
    .map((key) => key + '=' + process.env[key]);
  if (envOffenders.length > 0) {
    fail('构建环境变量不是占位值', '当前 shell 设置了占位值：' + envOffenders.join(', ') + '；请注入真实 HTTPS 地址 / 可收信邮箱');
  } else {
    pass('构建环境变量不是占位值', 'VITE_PRIVACY_URL / VITE_SUPPORT_EMAIL 未设置占位值');
  }
} catch (error) {
  fail('.env.example 占位值检查', error instanceof Error ? error.message : String(error));
}

// 4. 敏感文件不在 git 跟踪列表
try {
  const tracked = runGit(['ls-files', '-z']).split('\0').filter(Boolean);
  const hits = tracked.filter(isSensitivePath);
  if (hits.length > 0) {
    fail('敏感文件未被 git 跟踪', hits.join(', '));
  } else {
    pass('敏感文件未被 git 跟踪', '已检查 ' + tracked.length + ' 个跟踪文件');
  }
} catch {
  fail('无法读取 git 跟踪列表（需要在 git 仓库内运行且已安装 git）');
}

// 5. .gitignore 覆盖密钥 / 环境文件规则（含 AND-14 新增格式兜底）
try {
  const lines = read('.gitignore')
    .split(/\r?\n/)
    .map((line) => line.trim());
  const required = [
    '*.jks',
    '*.keystore',
    '*.pem',
    '*.p12',
    '*.p8',
    '*.key',
    'google-services.json',
    'signing.properties',
    'password.txt',
    '.env',
    '.env.*',
    '!.env.example',
    'android/keystore/',
    '.audit-work/',
  ];
  const missing = required.filter((rule) => !lines.includes(rule));
  if (missing.length > 0) {
    fail('.gitignore 覆盖密钥 / 环境文件规则', '缺少：' + missing.join(', '));
  } else {
    pass('.gitignore 覆盖密钥 / 环境文件规则', required.length + ' 条规则齐全');
  }
} catch (error) {
  fail('.gitignore 检查', error instanceof Error ? error.message : String(error));
}

// 6. FileProvider 白名单式校验：只允许 cachePath/exports/，其余任何 *-path 一律 FAIL
try {
  const xml = read('android/app/src/main/res/xml/file_paths.xml');
  const tags = [...xml.matchAll(/<([a-z][a-z-]*-path)\b([^>]*)>/g)].map((match) => ({
    tag: match[1],
    attrs: match[2],
  }));
  const isAllowed = (item) =>
    item.tag === 'cache-path' && /name="exports"/.test(item.attrs) && /path="exports\/"/.test(item.attrs);
  if (tags.length === 0) {
    fail('FileProvider 路径已收窄（白名单：仅 cache-path exports/）', '未找到任何 <*-path> 声明');
  } else {
    const offending = tags.filter((item) => !isAllowed(item));
    if (offending.length > 0) {
      fail(
        'FileProvider 路径已收窄（白名单：仅 cache-path exports/）',
        '出现白名单外路径：' + offending.map((item) => '<' + item.tag + item.attrs + '>').join(' '),
      );
    } else {
      pass('FileProvider 路径已收窄（白名单：仅 cache-path exports/）', tags.length + ' 条路径声明');
    }
  }
  note(
    'Capacitor 6 的 WebChromeClient 在 <input type=file capture> 拍照时会用同一 .fileprovider 写 getExternalFilesDir(Pictures)；' +
      '当前应用未使用 capture，故不需要该路径；若以后启用，请同时更新白名单与本节断言',
  );
} catch (error) {
  fail('FileProvider 路径检查', error instanceof Error ? error.message : String(error));
}

// 7. release 签名守卫 + debuggable release 守卫（AND-03）
try {
  const gradle = read('android/app/build.gradle');
  const hasGuard = gradle.includes('gradle.taskGraph.whenReady') && gradle.includes('GradleException');
  const tasksCovered = RELEASE_ARTIFACT_TASKS.every((name) => gradle.includes("'" + name + "'"));
  const blocksDebuggable =
    /gradle\.taskGraph\.whenReady[\s\S]*xinshiDebuggable[\s\S]*xinshiWebViewDebug/.test(gradle);
  if (!hasGuard) {
    fail('release 签名守卫已存在', 'build.gradle 中未找到 taskGraph.whenReady + GradleException');
  } else if (!tasksCovered) {
    fail('release 签名守卫覆盖产物任务', '缺少任务名：' + RELEASE_ARTIFACT_TASKS.join(', '));
  } else {
    pass('release 签名守卫已存在', '覆盖 ' + RELEASE_ARTIFACT_TASKS.length + ' 个 release 产物任务');
  }
  if (!blocksDebuggable) {
    fail('release 守卫拦截可调试构建', 'taskGraph 守卫中未同时引用 xinshiDebuggable / xinshiWebViewDebug');
  } else {
    pass('release 守卫拦截可调试构建', '-Pxinshi.debuggable / -Pxinshi.webViewDebug 会中止 release 产物任务');
  }
  // D01：-Pxinshi.diag 会让正式包把诊断写到公共 Download，必须与 debuggable 同等中止。
  const blocksDiag = /gradle\.taskGraph\.whenReady[\s\S]*if \(xinshiDiag\)[\s\S]*Download/.test(gradle);
  if (!blocksDiag) {
    fail(
      'release 守卫拦截诊断构建',
      'taskGraph 守卫中未找到对 xinshiDiag 的拒绝，或错误信息未说明诊断会写入公共 Download',
    );
  } else {
    pass('release 守卫拦截诊断构建', '-Pxinshi.diag 会中止 release 产物任务（错误信息说明写入公共 Download）');
  }
} catch (error) {
  fail('release 守卫检查', error instanceof Error ? error.message : String(error));
}

// 8. release 产物断言：debuggable / 版本 / 签名证书（AND-03、D02、D03）
//    aapt2 发现顺序：ANDROID_HOME → ANDROID_SDK_ROOT → local.properties 的 sdk.dir → 常见路径；
//    找不到时默认 FAIL（显式 SKIP_APK_CHECK=1 才降级为 NOTE 并说明跳过原因）。
try {
  const releaseDir = join(ROOT, 'release');
  const apkNames = existsSync(releaseDir)
    ? readdirSync(releaseDir).filter((name) => name.toLowerCase().endsWith('.apk'))
    : [];
  if (apkNames.length === 0) {
    // 产物还没打包：本地开发阶段允许 NOTE（STRICT 下视为发布阻断）。
    failInStrict(
      'release 产物存在',
      'release/ 下没有 APK，跳过 debuggable / 版本 / 签名断言；打包后请再跑一次 pnpm check:release',
    );
  } else if (SKIP_APK_CHECK) {
    note(
      'SKIP_APK_CHECK=1：跳过 release APK 的 debuggable / versionCode / versionName / 签名证书断言（本次未做产物级校验）',
    );
  } else {
    const aapt2 = findAapt2();
    if (!aapt2) {
      fail(
        '找到 aapt2 校验 release 产物',
        '已按 ANDROID_HOME → ANDROID_SDK_ROOT → android/local.properties 的 sdk.dir → 常见 SDK 路径探测，' +
          '均未找到 build-tools/*/aapt2；请安装 Android build-tools 或设置 ANDROID_HOME，' +
          '确实无 SDK 的环境请显式 SKIP_APK_CHECK=1 跳过并人工核对产物',
      );
    } else {
      // 8.1 debuggable：只校验最近 3 个产物（按 mtime 倒序），确保当前待发布包一定在检查范围内。
      const recentApks = apkNames
        .map((name) => ({ name, mtime: statSync(join(releaseDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 3)
        .map((item) => item.name);
      const badgingByApk = new Map();
      for (const apk of recentApks) {
        try {
          const badging = runTool(aapt2, ['dump', 'badging', join(releaseDir, apk)]);
          badgingByApk.set(apk, badging);
          if (/application-debuggable/.test(badging)) {
            fail('release APK 不可调试', apk + ' 含 application-debuggable');
          } else {
            pass('release APK 不可调试', apk + ' 无 application-debuggable');
          }
        } catch (error) {
          note('aapt2 校验 ' + apk + ' 失败：' + (error instanceof Error ? error.message : String(error)));
        }
      }

      // 8.2 版本：release/ 下版本号最高的 APK 必须与 package.json 期望一致（D03）。
      const latestApk = pickLatestVersionApk(apkNames, releaseDir);
      let expectedVersion = '';
      let expectedVersionCode = 0;
      try {
        expectedVersion = String(JSON.parse(read('package.json')).version ?? '');
      } catch {
        expectedVersion = '';
      }
      const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(expectedVersion);
      if (!semver) {
        note('package.json 版本号不可解析，跳过 release APK 版本断言');
      } else {
        expectedVersionCode =
          Number(semver[1]) * 1000 + Number(semver[2]) * 100 + Number(semver[3]);
        let badging = badgingByApk.get(latestApk);
        try {
          if (!badging) badging = runTool(aapt2, ['dump', 'badging', join(releaseDir, latestApk)]);
          const versionCode = /versionCode='(\d+)'/.exec(badging)?.[1];
          const versionName = /versionName='([^']+)'/.exec(badging)?.[1];
          if (!versionCode || !versionName) {
            fail('release APK 版本可解析', latestApk + ' 的 aapt2 badging 输出缺少 versionCode / versionName');
          } else if (versionName !== expectedVersion || Number(versionCode) !== expectedVersionCode) {
            fail(
              'release APK 版本与 package.json 一致',
              '最新产物 ' + latestApk + ' 为 ' + versionName + '（versionCode ' + versionCode + '），' +
                '期望 ' + expectedVersion + '（versionCode ' + expectedVersionCode + '）；' +
                '可能使用了 -Pxinshi.versionCode / -Pxinshi.versionName 覆盖，或产物已过期',
            );
          } else {
            pass(
              'release APK 版本与 package.json 一致',
              latestApk + ' = ' + versionName + '（versionCode ' + versionCode + '）',
            );
          }
        } catch (error) {
          fail(
            'release APK 版本可解析',
            '读取 ' + latestApk + ' 的 badging 失败：' + (error instanceof Error ? error.message : String(error)),
          );
        }
      }

      // 8.3 签名证书：apksigner --print-certs 的 SHA-256 必须等于发布登记值（D03）。
      const apksigner = findApksigner();
      if (!apksigner) {
        note(
          '未找到 apksigner（build-tools/*/apksigner），跳过 ' + latestApk +
            ' 的签名证书断言；请人工执行 apksigner verify --print-certs <apk> 核对证书 SHA-256',
        );
      } else {
        try {
          const output = runTool(apksigner, ['verify', '--print-certs', join(releaseDir, latestApk)]);
          const match = /certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/.exec(output);
          if (!match) {
            fail('release APK 签名证书与登记值一致', 'apksigner 输出中未找到证书 SHA-256 摘要');
          } else if (match[1].toLowerCase() !== EXPECTED_SIGNER_SHA256) {
            fail(
              'release APK 签名证书与登记值一致',
              latestApk + ' 证书 SHA-256=' + match[1].toLowerCase() +
                '，登记值=' + EXPECTED_SIGNER_SHA256 + '；可能用了错误的 keystore',
            );
          } else {
            pass(
              'release APK 签名证书与登记值一致',
              latestApk + ' 证书 SHA-256=' + match[1].toLowerCase(),
            );
          }
        } catch (error) {
          fail(
            'release APK 签名证书与登记值一致',
            'apksigner verify ' + latestApk + ' 失败：' + (error instanceof Error ? error.message : String(error)),
          );
        }
      }
    }
  }
} catch (error) {
  fail('release 产物断言', error instanceof Error ? error.message : String(error));
}

// 9. dist ↔ android/app/src/main/assets/public 逐文件 sha256 漂移断言（AND-05 / D04）
try {
  const DIST_DIR = 'dist';
  const ASSETS_DIR = 'android/app/src/main/assets/public';
  if (!existsSync(join(ROOT, DIST_DIR)) || !existsSync(join(ROOT, ASSETS_DIR))) {
    note(
      'dist/ 或 ' + ASSETS_DIR + '/ 不存在（尚未构建 / 未 cap sync），跳过 assets 漂移断言；' +
        '请先 pnpm build && pnpm exec cap sync android 再打包',
    );
  } else {
    const distFiles = hashTree(join(ROOT, DIST_DIR));
    const assetFiles = hashTree(join(ROOT, ASSETS_DIR));
    const missingInAssets = Object.keys(distFiles).filter((file) => !(file in assetFiles));
    const unexpectedInAssets = Object.keys(assetFiles).filter(
      (file) => !(file in distFiles) && !ASSETS_ONLY_FILES.includes(file),
    );
    const contentDiffs = Object.keys(distFiles).filter(
      (file) => file in assetFiles && distFiles[file] !== assetFiles[file],
    );
    const drift = [
      ...contentDiffs.map((file) => '内容不同：' + file),
      ...missingInAssets.map((file) => 'assets 缺失：' + file),
      ...unexpectedInAssets.map((file) => 'assets 多出：' + file),
    ];
    if (drift.length > 0) {
      fail(
        'assets/public 与 dist 同源（逐文件 sha256）',
        '检测到 ' + drift.length + ' 处漂移：' + drift.join('；') +
          '。请先 pnpm build && pnpm exec cap sync android 后重新打包',
      );
    } else {
      pass(
        'assets/public 与 dist 同源（逐文件 sha256）',
        '已比对 ' + Object.keys(distFiles).length + ' 个文件（白名单仅 ' + ASSETS_ONLY_FILES.join(' / ') + '）',
      );
    }
  }
} catch (error) {
  fail('assets 漂移断言', error instanceof Error ? error.message : String(error));
}

// 10. 构建产物 CSP meta（AND-07 由构建期注入；dist 不存在时 NOTE）
try {
  const distIndex = join(ROOT, 'dist/index.html');
  const configCandidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'];
  const configFile = configCandidates.find((name) => existsSync(join(ROOT, name)));
  const injectionConfigured = configFile
    ? readFileSync(join(ROOT, configFile), 'utf8').includes('Content-Security-Policy')
    : false;
  if (!existsSync(distIndex)) {
    note('dist/index.html 不存在（尚未构建），跳过 CSP meta 断言；pnpm build 后再跑一次');
  } else {
    const html = read('dist/index.html');
    const hasCsp = /http-equiv=["']Content-Security-Policy["']/i.test(html);
    if (hasCsp) {
      pass('dist/index.html 含 CSP meta', '构建期注入的 Content-Security-Policy 存在');
    } else if (injectionConfigured) {
      fail('dist/index.html 含 CSP meta', '构建链已配置 CSP 注入但产物缺失，请重新 pnpm build');
    } else {
      note('dist/index.html 缺少 CSP meta：构建链尚未配置注入（AND-07 由另一修复线负责），本轮不判 FAIL');
    }
  }
} catch (error) {
  note('CSP meta 断言未执行：' + (error instanceof Error ? error.message : String(error)));
}

console.log('');
note('正式包构建参数必须不含 -Pxinshi.debuggable / -Pxinshi.webviewDebug / -Pxinshi.diag（Gradle 守卫已强制中止）。');
note('上架前请用 VITE_PRIVACY_URL / VITE_SUPPORT_EMAIL 注入真实值，并人工打开确认可访问、可收信。');
note('设置 XINSHI_RELEASE_STRICT=1 可把「产物缺失」等人工确认项升级为 FAIL；无 Android SDK 时须显式 SKIP_APK_CHECK=1 跳过产物断言。');
console.log('');

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log('结果：' + passed + ' PASS / ' + failed + ' FAIL');
if (failed > 0) {
  console.log('存在配置问题：请修复后再发布。');
  process.exitCode = 1;
} else {
  console.log('发布前配置检查通过（NOTE / WARN 项仍需人工确认）。');
}
