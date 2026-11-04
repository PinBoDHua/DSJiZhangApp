import { Plus } from 'lucide-react';

export function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="fab" onClick={onClick} aria-label="记一笔工">
      <span className="fab-icon">
        <Plus size={20} strokeWidth={2.6} />
      </span>
      <span>记一笔</span>
    </button>
  );
}
