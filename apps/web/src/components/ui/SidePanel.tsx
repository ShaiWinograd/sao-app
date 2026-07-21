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
      className="fixed inset-0 z-50 bg-black/30 flex justify-end"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        dir="rtl"
        className={`h-full w-full ${widthClassName} bg-white shadow-xl overflow-y-auto flex flex-col`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={requestClose}
            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            סגירה
          </button>
          {title ? <h3 className="font-semibold text-gray-900">{title}</h3> : <span />}
        </div>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
