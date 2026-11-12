#!/usr/bin/env node
/**
 * 薪时发布前配置检查（只读，零依赖，仅使用 Node 原生 API）。
 * 用法：node scripts/check-release-config.mjs
 * 任一检查失败时进程退出码为 1；本脚本不会修改、创建或删除任何文件。
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

/** @param {string} title @param {string} [detail] */
function pass(title, detail = '') {
  results.push(true);
  console.log(`PASS  ${title}${detail ? ` —— ${detail}` : ''}`);
}

/** @param {string} title @param {string} [detail] */
function fail(title, detail = '') {
  results.push(false);
  console.log(`FAIL  ${title}${detail ? ` —— ${detail}` : ''}`);
}

/** @param {string} message */
function note(message) {
  console.log(`NOTE  ${message}`);
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
  if (/\.(jks|keystore)$/i.test(trackedPath)) return true;
  if (base === 'signing.properties' || base === 'password.txt') return true;
  if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return true;
  return false;
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
    fail('package.json 版本号可解析', `当前值 "${version}" 不是 x.y.z`);
  } else {
    const expectedVersionCode =
      Number(semver[1]) * 1000 + Number(semver[2]) * 100 + Number(semver[3]);

    if (!nameMatch) {
      fail('build.gradle 默认 versionName 可解析');
    } else if (nameMatch[1] !== version) {
      fail(
        'versionName 与 package.json 一致',
        `build.gradle="${nameMatch[1]}"，package.json="${version}"`,
      );
    } else {
      pass('versionName 与 package.json 一致', version);
    }

    if (!codeMatch) {
      fail('build.gradle 默认 versionCode 可解析');
    } else if (Number(codeMatch[1]) !== expectedVersionCode) {
      fail(
        'versionCode 与语义化版本对应',
        `build.gradle=${codeMatch[1]}，按 ${version} 应为 ${expectedVersionCode}`,
      );
    } else {
      pass('versionCode 与语义化版本对应', `${version} → ${expectedVersionCode}`);
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
    pass('public/sw.js CACHE_NAME 格式有效', `xinshi-v${current}`);

    try {
      const previousSource = runGit(['show', 'HEAD~1:public/sw.js']);
      const previous = previousSource.match(/const CACHE_NAME = 'xinshi-v(\d+)'/);
      if (!previous) {
        note('无法从上一提交解析 CACHE_NAME，跳过版本递增检查');
      } else if (Number(previous[1]) > current) {
        fail('SW 缓存版本未回退', `上一提交 v${previous[1]}，当前 v${current}`);
      } else if (Number(previous[1]) === current) {
        note(
          `SW 缓存版本与上一提交同为 v${current}：若本次发布包含 Web 资源变更，请在发布提交中确认已 bump`,
        );
      } else {
        pass('SW 缓存版本较上一提交递增', `v${previous[1]} → v${current}`);
      }
    } catch {
      note('无法读取上一提交的 public/sw.js（浅克隆或无 git），跳过版本递增检查');
    }
  }
} catch (error) {
  fail('public/sw.js 检查', error instanceof Error ? error.message : String(error));
}

// 3. 隐私政策默认地址：不能是已失效的 pinbodhua.github.io；相对路径必须有离线政策页
try {
  const compliance = read('src/lib/compliance.ts');
  const match = compliance.match(/VITE_PRIVACY_URL\s*\|\|\s*'([^']+)'/);
  const offlinePage = 'public/privacy-policy.html';

  if (!match) {
    fail('compliance.ts 中 PRIVACY_URL 默认值可解析');
  } else {
    const value = match[1];
    if (/pinbodhua\.github\.io/i.test(value)) {
      fail('PRIVACY_URL 默认值指向已失效地址', value);
    } else if (/^https?:\/\//i.test(value)) {
      pass('PRIVACY_URL 默认值不是已失效地址', value);
      note('PRIVACY_URL 默认为外部地址，请人工确认在无登录状态下可公开访问（HTTPS）');
    } else if (!existsSync(join(ROOT, offlinePage))) {
      fail('PRIVACY_URL 使用相对路径但离线政策页缺失', offlinePage);
    } else {
      const bytes = statSync(join(ROOT, offlinePage)).size;
      pass(
        'PRIVACY_URL 默认值指向离线政策页',
        `${value}（${offlinePage} 存在，${bytes} 字节，构建后会进入 dist/）`,
      );
      if (existsSync(join(ROOT, 'docs/privacy-policy.html'))) {
        const stored = read(offlinePage);
        const source = read('docs/privacy-policy.html');
        if (stored !== source) {
          note('public/privacy-policy.html 与 docs/privacy-policy.html 内容不一致，请同步更新离线副本');
        }
      }
    }
  }
} catch (error) {
  fail('隐私政策地址检查', error instanceof Error ? error.message : String(error));
}

// 4. 敏感文件不在 git 跟踪列表
try {
  const tracked = runGit(['ls-files', '-z']).split('\0').filter(Boolean);
  const hits = tracked.filter(isSensitivePath);
  if (hits.length > 0) {
    fail('敏感文件未被 git 跟踪', hits.join(', '));
  } else {
    pass('敏感文件未被 git 跟踪', `已检查 ${tracked.length} 个跟踪文件`);
  }
} catch {
  fail('无法读取 git 跟踪列表（需要在 git 仓库内运行且已安装 git）');
}

// 5. .gitignore 覆盖密钥 / 环境文件规则
try {
  const lines = read('.gitignore')
    .split(/\r?\n/)
    .map((line) => line.trim());
  const required = [
    '*.jks',
    '*.keystore',
    'signing.properties',
    'password.txt',
    '.env',
    '.env.*',
    '!.env.example',
    'android/keystore/',
  ];
  const missing = required.filter((rule) => !lines.includes(rule));
  if (missing.length > 0) {
    fail('.gitignore 覆盖密钥 / 环境文件规则', `缺少：${missing.join(', ')}`);
  } else {
    pass('.gitignore 覆盖密钥 / 环境文件规则', `${required.length} 条规则齐全`);
  }
} catch (error) {
  fail('.gitignore 检查', error instanceof Error ? error.message : String(error));
}

// 6. FileProvider 路径已收窄（与 SaveFilePlugin.shareViaLegacy 的 cacheDir/exports 一致）
try {
  const xml = read('android/app/src/main/res/xml/file_paths.xml');
  if (/<external-path/.test(xml)) {
    fail('FileProvider 路径已收窄', '仍包含 <external-path>');
  } else if (!/<cache-path[^>]*path="exports\/"/.test(xml)) {
    fail('FileProvider 路径已收窄', '未包含 cache-path path="exports/"');
  } else {
    pass('FileProvider 路径已收窄', '仅 cacheDir/exports/，无 external-path');
  }
  note(
    'Capacitor 6 的 WebChromeClient 在 <input type=file capture> 拍照时会用同一 .fileprovider 写 getExternalFilesDir(Pictures)；' +
      '当前应用未使用 capture，故不需要该路径；若以后启用，请补 <external-files-path name="capture" path="Pictures/" />',
  );
} catch (error) {
  fail('FileProvider 路径检查', error instanceof Error ? error.message : String(error));
}

// 7. release 签名守卫已存在（缺少 signing.properties 时 release 构建失败）
try {
  const gradle = read('android/app/build.gradle');
  if (gradle.includes('gradle.taskGraph.whenReady') && gradle.includes('GradleException')) {
    pass('release 签名守卫已存在', '缺少 signing.properties 时 release 构建显式失败');
  } else {
    fail('release 签名守卫已存在', 'build.gradle 中未找到 release 签名断言');
  }
} catch (error) {
  fail('release 签名守卫检查', error instanceof Error ? error.message : String(error));
}

console.log('');
note(
  '正式包必须不带 -Pxinshi.debuggable / -Pxinshi.webviewDebug 构建（这两个开关会生成 release 签名但可调试的测试包），',
);
note('并用 aapt2 dump badging 确认无 application-debuggable。');
note(
  'capacitor.config.ts 未写死 android.webContentsDebuggingEnabled=false：保留 -Pxinshi.webviewDebug 真机排查流程，',
);
note('发布者需自行确认正式包 WebView 调试已关闭。');
note('上架前请用 VITE_PRIVACY_URL 注入公开 HTTPS 地址并人工打开确认可访问。');
console.log('');

const passed = results.filter(Boolean).length;
const failed = results.length - passed;
console.log(`结果：${passed} PASS / ${failed} FAIL`);
if (failed > 0) {
  console.log('存在配置问题：请修复后再发布。');
  process.exitCode = 1;
} else {
  console.log('发布前配置检查通过（调试开关与隐私 URL 仍需按 NOTE 人工确认）。');
}