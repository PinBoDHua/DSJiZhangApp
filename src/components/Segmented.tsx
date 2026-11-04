interface Option<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  className?: string;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className = '',
  size = 'md',
  ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div
      className={`segmented segmented--${size} ${className}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={`segmented-item ${option.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          aria-pressed={option.value === value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
