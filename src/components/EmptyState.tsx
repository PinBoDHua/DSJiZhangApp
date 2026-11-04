import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  extra?: ReactNode;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  extra,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? 'empty-state--compact' : ''}`}>
      <span className="empty-icon">
        <Icon size={compact ? 22 : 26} strokeWidth={1.8} />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="btn btn--soft btn--sm" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {extra}
    </div>
  );
}
