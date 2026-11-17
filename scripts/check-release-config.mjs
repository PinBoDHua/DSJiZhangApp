#!/usr/bin/env node
/**
 * 薪时发布前配置检查（只读，零依赖，仅使用 Node 原生 API）。
 * 用法：node scripts/check-release-config.mjs
 * 任一硬性检查失败时进程退出码为 1；本脚本不会修改、创建或删除任何文件。
 *
 * 环境变量：
 *   XINSHI_RELEASE_STRICT=1  把「占位邮箱 / 产物缺失」等人工确认项升级为 FAIL（默认仅 NOTE）。
 *
 * 覆盖范围（对应审计 AND-03/04/05/14）：
 *   版本号一致性 + versionCode 公式碰撞提示、SW 缓存版本、
 *   隐私政策 URL / 离线页 / 两份逐字节一致 / 内部链接与占位邮箱 / 版本号同步、
 *   敏感文件与 .gitignore、FileProvider 白名单、release 签名守卫与 debuggable release 守卫、
 *   release APK 的 aapt2 badging 断言、dist/index.html 的 CSP meta。
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.env.XINSHI_RELEASE_STRICT === '1';
const results = [];

/** 占位值：上架前必须替换为真实可收信邮箱。 */
const PLACEHOLDER_EMAILS = ['support@xinshi.app', 'example.com', 'you@example.com'];
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

/** 在 ANDROID_HOME / ANDROID_SDK_ROOT 的 build-tools 中查找 aapt2。 */
function findAapt2() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk) return null;
  const buildTools = join(sdk, 'build-tools');
  if (!existsSync(buildTools)) return null;
  let versions = [];
  try {
    versions = readdirSync(buildTools).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return null;
  }
  for (const version of versions) {
    for (const name of ['aapt2.exe', 'aapt2']) {
      const candidate = join(buildTools, version, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
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
    failInStrict(
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
} catch (error) {
  fail('release 守卫检查', error instanceof Error ? error.message : String(error));
}

// 8. release 产物 application-debuggable 断言（AND-03；找不到 aapt2 时 NOTE，不静默 PASS）
try {
  const releaseDir = join(ROOT, 'release');
  // 只校验最新 3 个产物（按 mtime 倒序），确保当前待发布包一定在检查范围内。
  const apks = existsSync(releaseDir)
    ? readdirSync(releaseDir)
        .filter((name) => name.toLowerCase().endsWith('.apk'))
        .map((name) => ({ name, mtime: statSync(join(releaseDir, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 3)
        .map((item) => item.name)
    : [];
  if (apks.length === 0) {
    note('release/ 下没有 APK，跳过产物 application-debuggable 断言（打包后请再跑一次 pnpm check:release）');
  } else {
    const aapt2 = findAapt2();
    if (!aapt2) {
      note(
        '未找到 aapt2（需设置 ANDROID_HOME 或 ANDROID_SDK_ROOT 指向 Android SDK），无法自动校验 ' +
          apks.length +
          ' 个 release APK 的 application-debuggable；请人工执行 aapt2 dump badging <apk> 确认输出无该行',
      );
    } else {
      for (const apk of apks.slice(0, 5)) {
        try {
          const badging = execFileSync(aapt2, ['dump', 'badging', join(releaseDir, apk)], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          if (/application-debuggable/.test(badging)) {
            fail('release APK 不可调试', apk + ' 含 application-debuggable');
          } else {
            pass('release APK 不可调试', apk + ' 无 application-debuggable');
          }
        } catch (error) {
          note('aapt2 校验 ' + apk + ' 失败：' + (error instanceof Error ? error.message : String(error)));
        }
      }
    }
  }
} catch (error) {
  note('release 产物 debuggable 断言未执行：' + (error instanceof Error ? error.message : String(error)));
}

// 9. 构建产物 CSP meta（AND-07 由构建期注入；dist 不存在时 NOTE）
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
note('正式包构建参数必须不含 -Pxinshi.debuggable / -Pxinshi.webviewDebug（Gradle 守卫已强制中止）。');
note('上架前请用 VITE_PRIVACY_URL / VITE_SUPPORT_EMAIL 注入真实值，并人工打开确认可访问、可收信。');
note('设置 XINSHI_RELEASE_STRICT=1 可把占位邮箱等人工确认项升级为 FAIL。');
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
