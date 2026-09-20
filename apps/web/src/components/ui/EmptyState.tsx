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
    <div className="flex min-h-64 flex-col items-center justify-center rounded-[24px] border border-[#e7e3dc] bg-white px-6 py-12 text-center shadow-[0_2px_12px_rgba(38,38,38,0.04)]">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
        {icon}
      </div>
      <h2 className="mt-5 text-lg font-semibold text-gray-900">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
