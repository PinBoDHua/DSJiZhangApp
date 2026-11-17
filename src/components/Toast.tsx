import { useEffect, useRef } from 'react';
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
  // 动作只执行一次；新提示刚上屏的瞬间忽略点击，避免连点第二次落到队列里的下一条提示动作上。
  const actedRef = useRef(false);
  const shownAtRef = useRef(0);
  useEffect(() => {
    actedRef.current = false;
    shownAtRef.current = Date.now();
  }, [toast?.id]);
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
                if (actedRef.current) return;
                // 上一条提示的连点会落在刚上屏的下一条按钮上：250ms 内不响应。
                if (Date.now() - shownAtRef.current < 250) return;
                actedRef.current = true;
                const action = toast.action;
                // 先执行动作再关掉当前提示：store 会把动作里产生的新提示排到队尾，
                // 若先 onClose 再执行动作，刚排到队首的提示会被动作里的 toast 顶掉。
                try {
                  action?.onClick();
                } finally {
                  // 队列推进延后一帧，进一步避免同一次连点命中下一条提示。
                  const close = () => onClose();
                  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(close);
                  else window.setTimeout(close, 0);
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
