/**
 * 页面滚动锁：抽屉和确认框可以叠在一起，用引用计数避免“后关的那层把 overflow 写回 hidden”。
 * 只在第一个弹层打开时记录原始值，全部关闭后恢复。
 */
let lockCount = 0;
let savedOverflow = '';

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow;
      savedOverflow = '';
    }
  };
}
