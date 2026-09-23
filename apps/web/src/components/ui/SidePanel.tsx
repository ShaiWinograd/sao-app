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
      className="fixed inset-0 z-50 flex justify-end bg-[#292724]/35 backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        dir="rtl"
        className={`flex h-full w-full ${widthClassName} flex-col overflow-y-auto border-r border-[var(--color-border-strong)] bg-[var(--color-background)] shadow-[0_18px_45px_rgba(41,39,36,0.16)]`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-start border-b border-[var(--color-border)] bg-[var(--color-background)]/95 px-6 py-5 backdrop-blur">
          {title ? <h3 className="font-display text-xl font-medium text-gray-900">{title}</h3> : <span />}
        </div>
        <div className="flex-1">{children}</div>
        <div className="sticky bottom-0 z-10 shrink-0 border-t border-[var(--color-border)] bg-[var(--color-background)]/95 px-6 py-4 backdrop-blur">
          <button
            type="button"
            onClick={requestClose}
            className="min-h-11 w-full border border-[var(--color-border-strong)] bg-transparent px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-[var(--color-surface-muted)]"
          >
            {hasUnsavedChanges ? 'סגירה ללא שמירה' : 'סגירה'}
          </button>
        </div>
      </div>
    </div>
  );
}
