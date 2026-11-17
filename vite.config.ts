import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const emptyModule = fileURLToPath(new URL('./src/lib/emptyModule.ts', import.meta.url));
const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

/** 预缓存清单只收离线启动必需的静态资源（字体 2.4MB 不进清单，避免首装下载过重）。 */
const PRECACHE_EXTENSIONS = new Set(['.js', '.css', '.html', '.webmanifest', '.svg', '.png']);
const PRECACHE_IGNORE = new Set(['sw.js', 'precache-manifest.json']);

/**
 * UI-11：构建期生成 dist/precache-manifest.json（不引 workbox）。
 * Service Worker 安装时按清单 addAll，新装 PWA 立即断网也能打开全部懒加载路由。
 */
function precacheManifestPlugin(): Plugin {
  let outDir = '';
  let base = '/';
  return {
    name: 'xinshi:precache-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base.endsWith('/') ? config.base : config.base + '/';
    },
    closeBundle() {
      // closeBundle 时 dist 已写完（含 public 复制），扫产物目录比只看 bundle 更全。
      const files: string[] = [];
      const walk = (dir: string, prefix: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (PRECACHE_IGNORE.has(entry.name)) continue;
          const rel = prefix ? prefix + '/' + entry.name : entry.name;
          if (entry.isDirectory()) {
            walk(join(dir, entry.name), rel);
            continue;
          }
          if (PRECACHE_EXTENSIONS.has(extname(entry.name))) files.push(base + rel);
        }
      };
      walk(outDir, '');
      files.sort((a, b) => a.localeCompare(b));
      // 入口放最前：安装中断时也先保证应用能打开。
      const ordered = [
        ...files.filter((file) => file.endsWith('/index.html')),
        ...files.filter((file) => !file.endsWith('/index.html')),
      ];
      writeFileSync(
        join(outDir, 'precache-manifest.json'),
        JSON.stringify({ files: ordered }, null, 2) + '\n',
      );
    },
  };
}

/**
 * AND-07：构建期给 index.html 注入 meta CSP。
 * 内联主题脚本按原文算 sha256 放行，其余脚本要求同源；dev 不注入，避免 HMR 内联脚本被拦。
 */
function cspPlugin(): Plugin {
  return {
    name: 'xinshi:csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const hashes: string[] = [];
        const pattern = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
        for (const match of html.matchAll(pattern)) {
          hashes.push(createHash('sha256').update(match[1], 'utf8').digest('base64'));
        }
        const scriptSrc = ["script-src 'self'"]
          .concat(hashes.map((hash) => "'sha256-" + hash + "'"))
          .join(' ');
        const policy = [
          "default-src 'self'",
          scriptSrc,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
          "manifest-src 'self'",
        ].join('; ');
        const meta = '<meta http-equiv="Content-Security-Policy" content="' + policy + '" />';
        const charset = /<meta\s+charset="UTF-8"\s*\/?>/i;
        return charset.test(html)
          ? html.replace(charset, (matched) => matched + '\n    ' + meta)
          : html.replace(/<head>/i, (matched) => matched + '\n    ' + meta);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifestPlugin(), cspPlugin()],
  define: {
    // 版本号只认 package.json，避免关于页 / 引导页 / 搬家包各写一份。
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      // jsPDF 仅在 html() 时用 html2canvas；薪时不用 html()，避免 200KB 无用包。
      html2canvas: emptyModule,
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
