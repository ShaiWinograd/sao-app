'use client';

import { useEffect, useRef, useState } from 'react';
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
  const drawerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Close the drawer whenever the route changes (a nav item was tapped).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // The drawer is a mobile-only affordance; force it closed at md+ (e.g. after a
  // rotation/resize) so desktop content is never left inert behind a hidden drawer.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      if (mq.matches) setOpen(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Close on Escape and lock body scroll while the overlay is up. The cleanup
  // restores scroll on close and on unmount.
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

  // Keep keyboard focus out of the off-screen drawer when closed, and out of the
  // page behind the overlay when open (so focus is never stranded behind the
  // drawer). Move focus into the drawer on open and back to the hamburger on
  // close. `inert` also removes the elements from the a11y tree and tab order.
  useEffect(() => {
    if (drawerRef.current) drawerRef.current.inert = !open;
    if (mainRef.current) mainRef.current.inert = open;
    if (open) {
      closeBtnRef.current?.focus();
    } else if (wasOpen.current) {
      hamburgerRef.current?.focus();
    }
    wasOpen.current = open;
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
        ref={drawerRef}
        className={`fixed inset-y-0 right-0 z-50 w-64 max-w-[82%] transform pt-[env(safe-area-inset-top)] transition-transform duration-200 ease-out md:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="תפריט ניווט"
      >
        <button
          type="button"
          ref={closeBtnRef}
          onClick={() => setOpen(false)}
          aria-label="סגירת תפריט"
          className="absolute left-2 top-2 z-10 rounded-lg p-2 text-gray-500 hover:bg-gray-100"
        >
          <X className="h-5 w-5" />
        </button>
        <WorkerSidebar onNavigate={() => setOpen(false)} />
      </div>

      {/* Main column */}
      <div ref={mainRef} className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur pt-[env(safe-area-inset-top)] md:hidden">
          <div className="flex h-14 items-center gap-3 px-3">
            <button
              type="button"
              ref={hamburgerRef}
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
