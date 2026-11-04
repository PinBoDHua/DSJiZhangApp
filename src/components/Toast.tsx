import { createPortal } from 'react-dom';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import type { ToastTone } from '../types';

interface ToastProps {
  toast: { id: number; message: string; tone: ToastTone } | null;
  onClose: () => void;
}

const ICONS = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
};

export function Toast({ toast, onClose }: ToastProps) {
  if (!toast) return null;
  const Icon = ICONS[toast.tone] ?? Info;
  return createPortal(
    <div className="toast-wrap" aria-live="polite" aria-atomic="true">
      <div className={`toast toast--${toast.tone}`} role="status" key={toast.id}>
        <Icon size={18} strokeWidth={2.2} />
        <span>{toast.message}</span>
        <button type="button" className="toast-close" onClick={onClose} aria-label="关闭提示">
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
