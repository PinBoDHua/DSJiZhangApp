import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert } from 'lucide-react';
import { pushNativeBack } from '../lib/nativeBack';
import { useModalFocus } from '../hooks/useModalFocus';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef(onCancel);
  const dialogRef = useRef<HTMLDivElement>(null);
  cancelRef.current = onCancel;
  useModalFocus(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    return pushNativeBack(() => cancelRef.current());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 确认框可能叠在抽屉上：只关闭最上面这一层。
      event.stopImmediatePropagation();
      onCancel();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', handleKey, true);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {danger ? (
          <span className="dialog-icon dialog-icon--danger">
            <TriangleAlert size={22} />
          </span>
        ) : null}
        <h2>{title}</h2>
        {description ? <div className="dialog-desc">{description}</div> : null}
        <div className="dialog-actions">
          <button type="button" className="btn btn--ghost" data-initial-focus onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
