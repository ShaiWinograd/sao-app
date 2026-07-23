'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import WorkerSidebar from './WorkerSidebar';

// Responsive chrome for the whole worker web area (worker_web_spec §1).
// Desktop (md+): the sidebar is a static column. Mobile (<md): the sidebar
// collapses behind a hamburger and slides in as a right-anchored drawer (RTL),
// so page content always uses the full viewport width. Opening/closing the
// drawer is local UI state — it never changes the route or the report state.
export default function WorkerShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes (a nav item was tapped), and on
  // Escape. Lock body scroll while the overlay is up.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <div className="worker-theme flex h-screen overflow-x-hidden bg-white" dir="rtl">
      {/* Desktop sidebar */}
      <div className="hidden h-screen w-56 shrink-0 md:block">
        <WorkerSidebar />
      </div>

      {/* Mobile drawer overlay */}
      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile drawer (right-anchored for RTL) */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-64 max-w-[82%] transform pt-[env(safe-area-inset-top)] transition-transform duration-200 ease-out md:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="תפריט ניווט"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="סגירת תפריט"
          className="absolute left-2 top-2 z-10 rounded-lg p-2 text-gray-500 hover:bg-gray-100"
        >
          <X className="h-5 w-5" />
        </button>
        <WorkerSidebar onNavigate={() => setOpen(false)} />
      </div>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center gap-3 px-3">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="פתיחת תפריט"
              aria-expanded={open}
              className="-mr-1 rounded-lg p-2 text-gray-600 hover:bg-gray-100"
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
                <Image src="/so-logo.jpg" alt="Space and Order" width={32} height={32} className="object-cover" />
              </div>
              <span className="text-sm font-bold text-gray-900">S&amp;O · אזור העובדות</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden border-r border-gray-200">
          <div className="w-full max-w-none p-4 pb-[env(safe-area-inset-bottom)] sm:p-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
