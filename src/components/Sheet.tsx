import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { pushNativeBack } from '../lib/nativeBack';
import { lockBodyScroll } from '../lib/scrollLock';
import { useModalFocus } from '../hooks/useModalFocus';

interface SheetProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  ariaLabel?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

const EXIT_MS = 190;

export function Sheet({
  open,
  title,
  subtitle,
  ariaLabel,
  onClose,
  children,
  className = '',
}: SheetProps) {
  const closeRef = useRef(onClose);
  const sheetRef = useRef<HTMLDivElement>(null);
  closeRef.current = onClose;

  // 关闭时先播一段下滑淡出再卸载；打开 / 焦点 / 滚动锁仍由 open 即时驱动。
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);

  // 受控打开时 visible 要等下一帧才为 true：用 `open && visible` 作为焦点管理条件，
  // 否则首次打开的 commit 里弹层还没渲染、sheetRef 仍是 null，焦点陷阱会静默失效。
  // 关闭时 open 先变 false，焦点立即归还触发元素；淡出动画继续由 visible 驱动。
  useModalFocus(open && visible, sheetRef);

  useEffect(() => {
    if (open) {
      setVisible(true);
      setClosing(false);
      return;
    }
    if (!visible) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(false);
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, visible]);

  useEffect(() => {
    if (!open) return;
    return pushNativeBack(() => closeRef.current());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const releaseScroll = lockBodyScroll();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      releaseScroll();
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!visible) return null;

  return createPortal(
    <div
      className={`sheet-layer ${closing ? 'is-closing' : ''}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={`sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || '编辑'}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-grabber" aria-hidden="true" />
        {title ? (
          <header className="sheet-head">
            <div>
              <h2>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
            <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
              <X size={20} />
            </button>
          </header>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}