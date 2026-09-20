'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * Shared right-side slide-over panel used for customer create/edit, Quick Create,
 * and job edit. Dismissal rules (spec, item 3):
 *  - clicking the backdrop closes the panel;
 *  - Escape closes it (desktop);
 *  - clicking inside the panel must not close it;
 *  - when there are unsaved changes, a confirmation is shown before discarding;
 *  - the explicit "סגירה" button remains available.
 */
export function SidePanel({
  open,
  onClose,
  title,
  hasUnsavedChanges = false,
  unsavedMessage = 'יש שינויים שלא נשמרו. לצאת ולבטל אותם?',
  widthClassName = 'sm:max-w-md',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  hasUnsavedChanges?: boolean;
  unsavedMessage?: string;
  widthClassName?: string;
  children: ReactNode;
}) {
  const requestClose = () => {
    if (hasUnsavedChanges && typeof window !== 'undefined' && !window.confirm(unsavedMessage)) return;
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // requestClose closes over hasUnsavedChanges; re-bind when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasUnsavedChanges]);

  if (!open) return null;

  return (
    // Using onMouseDown + target check so a drag that starts inside the panel and
    // ends on the backdrop does not count as a backdrop click.
    <div
      className="fixed inset-0 z-50 flex justify-end bg-gray-950/35 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        dir="rtl"
        className={`flex h-full w-full ${widthClassName} flex-col overflow-y-auto bg-[#fbfaf7] shadow-[0_20px_60px_rgba(38,38,38,0.2)] sm:rounded-l-3xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-[#e7e3dc] bg-[#fbfaf7]/95 px-5 py-4 backdrop-blur">
          <button
            type="button"
            onClick={requestClose}
            className="min-h-11 rounded-xl border border-[#d8d3ca] bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            סגירה
          </button>
          {title ? <h3 className="text-lg font-semibold text-gray-900">{title}</h3> : <span />}
        </div>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
