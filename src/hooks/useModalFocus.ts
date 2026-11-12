import { useEffect, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * 抽屉 / 确认框的焦点管理：
 * - 打开后把焦点交给弹层，关闭后还给原来的元素；
 * - Tab / Shift+Tab 在弹层内部循环，不跑到背后的页面。
 */
export function useModalFocus(open: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const timer = window.setTimeout(() => {
      const initial = node.querySelector<HTMLElement>('[data-initial-focus]');
      if (initial) {
        initial.focus({ preventScroll: true });
        return;
      }
      // autoFocus 等已把焦点放进弹层时不抢焦点，避免输入框键盘弹起又立刻收回。
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        active !== node &&
        node.contains(active) &&
        active.matches(FOCUSABLE_SELECTOR)
      ) {
        return;
      }
      node.focus({ preventScroll: true });
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      // 嵌套弹层时只处理焦点所在的那一层。
      if (!node.contains(document.activeElement)) {
        const active = document.activeElement;
        // 焦点在其他真实元素上（可能是更上层弹层）：不干预。
        if (active && active !== document.body && active !== document.documentElement) return;
        // 焦点丢失到 body（如按钮变 disabled）：由最上层弹层收回，防止 Tab 逃逸到背景页。
        const layers = Array.from(
          document.querySelectorAll<HTMLElement>('[role="dialog"],[role="alertdialog"]'),
        );
        const top = layers[layers.length - 1];
        if (top && top !== node && !node.contains(top)) return;
        event.preventDefault();
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (element) => element.getClientRects().length > 0,
        );
        (items[0] ?? node).focus({ preventScroll: true });
        return;
      }
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getClientRects().length > 0,
      );
      if (items.length === 0) {
        event.preventDefault();
        node.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (document.activeElement === node) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open, ref]);
}
