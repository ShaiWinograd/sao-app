import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center border-y border-[var(--color-border)] px-6 py-9 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-primary-200 bg-primary-50 text-primary-700">
        {icon}
      </div>
      <h2 className="mt-4 text-base font-semibold text-[#292724] sm:text-lg">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-[var(--color-text-secondary)]">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
