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
    <header className="flex flex-col gap-5 border-b border-[#ded9d0] pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        {icon && (
          <div className="mt-1 hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 sm:flex">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-sm font-semibold text-primary-700">{eyebrow}</p>}
          <h1 className="text-[2rem] font-bold leading-tight tracking-[-0.02em] text-gray-950">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-base leading-7 text-gray-600">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
