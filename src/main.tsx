import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import { installNativeBack, installWebBack } from './lib/nativeBack';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

const nativeShell = Boolean(
  (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.(),
);

if (import.meta.env.PROD && !nativeShell && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('离线缓存注册失败', error);
    });
  });
}

// 新版部署后旧页面的懒加载 chunk 可能 404：自动刷新一次拿新页面；30 秒内不重复刷新，避免死循环。
let preloadReloadAt = 0;

function markPreloadReload(): boolean {
  const now = Date.now();
  try {
    const last = Number(sessionStorage.getItem('xinshi.preloadReload') || 0);
    if (now - last < 30_000) return false;
    sessionStorage.setItem('xinshi.preloadReload', String(now));
    preloadReloadAt = now;
    return true;
  } catch {
    // sessionStorage 不可用（隐私模式等）时用内存变量节流，避免每次错误都整页刷新
    if (now - preloadReloadAt < 30_000) return false;
    preloadReloadAt = now;
    return true;
  }
}

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (!markPreloadReload()) return;
  window.location.reload();
});

// 原生壳（Android）用 Capacitor backButton；网页 / PWA 用 history 哨兵 + popstate 桥接返回键，
// 这样打开子页 / 弹层时按返回是关闭当前层，而不是直接退出 App（C04）。
if (nativeShell) {
  void installNativeBack();
} else {
  installWebBack();
}
