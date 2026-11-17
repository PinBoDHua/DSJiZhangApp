import { useEffect } from 'react';
import type { ThemeMode } from '../types';
import { THEME_KEY } from '../lib/storage';

function apply(mode: ThemeMode): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const dark = mode === 'dark' || (mode === 'system' && media.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0F1714' : '#146B4B');
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // 存储不可用时不影响主题切换
  }
}

export function useTheme(mode: ThemeMode): void {
  useEffect(() => {
    apply(mode);
    if (mode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => apply('system');
    // Safari < 14 没有 MediaQueryList.addEventListener
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [mode]);

  useEffect(() => {
    // 跨标签页同步（UI-39）：storage 事件只在其他标签页写入时触发。
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY || event.newValue === null) return;
      const next = event.newValue;
      if (next === 'light' || next === 'dark' || next === 'system') apply(next);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);
}
