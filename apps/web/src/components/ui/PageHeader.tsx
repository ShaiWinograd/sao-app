import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-[var(--color-border-strong)] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[11px] font-semibold tracking-[0.12em] text-primary-700">{eyebrow}</p>}
        <h1 className="font-display text-[2rem] font-semibold leading-[1.15] tracking-[-0.02em] text-[#292724] sm:text-[2.65rem]">{title}</h1>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
