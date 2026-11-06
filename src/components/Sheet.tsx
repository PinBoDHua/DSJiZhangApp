import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { pushNativeBack } from '../lib/nativeBack';
import { useModalFocus } from '../hooks/useModalFocus';

interface SheetProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export function Sheet({ open, title, subtitle, onClose, children, className = '' }: SheetProps) {
  const closeRef = useRef(onClose);
  const sheetRef = useRef<HTMLDivElement>(null);
  closeRef.current = onClose;
  useModalFocus(open, sheetRef);

  useEffect(() => {
    if (!open) return;
    return pushNativeBack(() => closeRef.current());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="sheet-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={`sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title || '编辑'}
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
