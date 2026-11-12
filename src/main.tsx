import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import { installNativeBack } from './lib/nativeBack';

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
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    const last = Number(sessionStorage.getItem('xinshi.preloadReload') || 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem('xinshi.preloadReload', String(Date.now()));
  } catch {
    // sessionStorage 不可用时仍刷新一次
  }
  window.location.reload();
});

if (nativeShell) {
  void installNativeBack();
}
