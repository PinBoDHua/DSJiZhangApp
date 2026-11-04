import type { JobColor } from '../types';
import { jobColor } from '../lib/meta';

export function JobDot({
  color,
  size = 10,
  ring = false,
}: {
  color: JobColor;
  size?: number;
  ring?: boolean;
}) {
  const meta = jobColor(color);
  return (
    <span
      className={`job-dot ${ring ? 'job-dot--ring' : ''}`}
      style={{
        width: size,
        height: size,
        background: meta.main,
        boxShadow: ring ? `0 0 0 3px ${meta.soft}` : undefined,
      }}
      aria-hidden="true"
    />
  );
}

export function JobPill({
  color,
  name,
  subtle = false,
}: {
  color: JobColor;
  name: string;
  subtle?: boolean;
}) {
  const meta = jobColor(color);
  return (
    <span
      className="job-pill"
      style={{
        background: subtle ? 'var(--surface-muted)' : meta.soft,
        color: subtle ? 'var(--muted)' : meta.ink,
      }}
    >
      <span className="job-pill-dot" style={{ background: meta.main }} />
      {name}
    </span>
  );
}
