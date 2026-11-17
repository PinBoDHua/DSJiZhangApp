const CACHE_NAME = 'xinshi-v32';
// 保留上一版缓存：新版部署后仍开着的旧页面，懒加载 chunk 还能命中旧缓存。
const KEEP_VERSIONS = 2;
const CORE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/**
 * 预缓存（UI-11）：构建期生成的 dist/precache-manifest.json 列出全部路由 chunk 与静态资源，
 * 新装 PWA 直接断网也能打开任意页面；清单缺失或请求失败时回退到 CORE。
 */
function precache() {
  return fetch('/precache-manifest.json', { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error('预缓存清单请求失败：' + response.status);
      return response.json();
    })
    .then((manifest) => {
      const files = manifest && Array.isArray(manifest.files) ? manifest.files : [];
      if (files.length === 0) throw new Error('预缓存清单为空');
      return caches.open(CACHE_NAME).then((cache) => cache.addAll(files));
    })
    .catch(() => caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // 只清理薪时自己的版本缓存；同源其他应用的缓存不动（UI-38）。
        const versions = keys
          .filter((key) => /^xinshi-v\d+$/.test(key))
          .sort((a, b) => Number(b.slice(8)) - Number(a.slice(8)));
        const keep = new Set(versions.slice(0, KEEP_VERSIONS));
        return Promise.all(
          versions.filter((key) => !keep.has(key)).map((key) => caches.delete(key)),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 只缓存正常响应：5xx / 404 / 门户重定向页不能污染离线兜底。
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put('/index.html', copy))
                .catch(() => undefined),
            );
          }
          return response;
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || caches.match('/')),
        ),
    );
    return;
  }

  const network = fetch(request)
    .then((response) => {
      if (response.ok && !response.redirected) {
        const copy = response.clone();
        event.waitUntil(
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, copy))
            .catch(() => undefined),
        );
      }
      return response;
    })
    .catch(() => undefined);
  // 同步登记后台更新，避免缓存写入在 SW 空闲时被中止。
  event.waitUntil(network);
  event.respondWith(
    caches.match(request).then(
      (cached) => cached || network.then((response) => response || Response.error()),
    ),
  );
});
