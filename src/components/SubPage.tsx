import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface SubPageProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function SubPage({ title, subtitle, onBack, action, footer, children }: SubPageProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, []);

  return (
    <div className="subpage">
      <div className="subpage-inner">
        <header className="subpage-head">
          <button type="button" className="icon-button icon-button--back" onClick={onBack} aria-label="返回">
            <ArrowLeft size={21} />
          </button>
          <div className="subpage-title">
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="subpage-action">{action}</div>
        </header>
        <div className="subpage-scroll" ref={scrollRef}>
          {children}
        </div>
        {footer ? <div className="subpage-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
