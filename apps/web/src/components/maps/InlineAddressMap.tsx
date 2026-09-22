'use client';

import { useState } from 'react';

export function InlineAddressMap({
  address,
  compact = false,
}: {
  address: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const embedUrl = `https://www.google.com/maps?q=${encodeURIComponent(address)}&output=embed`;

  return (
    <div className={compact ? 'mt-2' : 'mt-3'}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${address}, ${open ? 'סגירת מפה' : 'פתיחת מפה'}`}
        className="max-w-full text-right text-sm font-medium text-primary-800 underline decoration-primary-300 underline-offset-4 hover:text-primary-950"
      >
        {address}
      </button>
      {open && (
        <div className="mt-3 overflow-hidden border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
          <iframe
            title={`מפה של ${address}`}
            src={embedUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className={compact ? 'h-44 w-full' : 'h-64 w-full'}
          />
        </div>
      )}
    </div>
  );
}
