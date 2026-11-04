export function Logo({ size = 36, light = false }: { size?: number; light?: boolean }) {
  const outer = light ? '#F4F1E8' : '#14563D';
  const clock = light ? '#14563D' : '#F7F1E3';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="logo-mark"
    >
      <rect width="40" height="40" rx="12" fill={outer} />
      <circle cx="19" cy="21" r="10.2" stroke={clock} strokeWidth="2.2" />
      <path
        d="M19 14.8V21L23.1 24"
        stroke={clock}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="31.2" cy="9.2" r="3.2" fill="#E9A13B" />
      <circle cx="31.2" cy="9.2" r="1.1" fill={outer} />
    </svg>
  );
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className={`wordmark ${light ? 'wordmark--light' : ''}`}>
      <strong>薪时</strong>
      <em>XINSHI</em>
    </span>
  );
}
