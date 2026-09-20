import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
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
      <div className="flex min-w-0 items-start gap-3 sm:gap-4">
        {icon && (
          <div className="mt-1 hidden h-10 w-10 shrink-0 items-center justify-center border-r-2 border-primary-400 pr-3 text-primary-700 sm:flex">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-xs font-semibold tracking-[0.04em] text-primary-700">{eyebrow}</p>}
          <h1 className="text-[1.85rem] font-semibold leading-tight tracking-[-0.025em] text-[#292724] sm:text-[2.2rem]">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)] sm:text-base">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
