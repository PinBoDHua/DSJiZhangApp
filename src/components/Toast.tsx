import { createPortal } from 'react-dom';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import type { ToastAction, ToastTone } from '../types';

interface ToastProps {
  toast: { id: number; message: string; tone: ToastTone; action?: ToastAction } | null;
  onClose: () => void;
}

const ICONS = {
  success: CheckCircle2,
  error: CircleAlert,
  info: Info,
};

export function Toast({ toast, onClose }: ToastProps) {
  const Icon = toast ? (ICONS[toast.tone] ?? Info) : Info;
  // aria-live 容器常驻：随内容一起挂载时读屏可能不播报。
  return createPortal(
    <div className="toast-wrap" aria-live="polite" aria-atomic="true">
      {toast ? (
        <div className={`toast toast--${toast.tone}`} role="status" key={toast.id}>
          <Icon size={18} strokeWidth={2.2} />
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const action = toast.action;
                // 先执行动作再关掉当前提示：store 会把动作里产生的新提示排到队尾，
                // 若先 onClose 再执行动作，刚排到队首的提示会被动作里的 toast 顶掉。
                try {
                  action?.onClick();
                } finally {
                  onClose();
                }
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" className="toast-close" onClick={onClose} aria-label="关闭提示">
            <X size={14} />
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
