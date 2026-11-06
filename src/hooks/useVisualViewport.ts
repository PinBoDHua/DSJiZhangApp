import { useEffect } from 'react';

/**
 * 把可视视口（含软键盘）同步到 CSS 变量：
 * - `--vvh`：可视视口高度；
 * - `--keyboard-inset`：软键盘占掉的高度。
 * 底部抽屉据此收缩，保存按钮不会被键盘盖住。
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!viewport) return;

    const update = () => {
      const height = Math.round(viewport.height || window.innerHeight);
      const inset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );
      root.style.setProperty('--vvh', `${height}px`);
      root.style.setProperty('--keyboard-inset', `${inset}px`);
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--keyboard-inset');
    };
  }, []);
}
