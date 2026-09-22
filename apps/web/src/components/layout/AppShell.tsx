'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';
import WorkerSidebar from './WorkerSidebar';
import { BrandLockup } from './BrandLockup';

type AppArea = 'owner' | 'worker';

const areaConfig = {
  owner: {
    themeClass: '',
  },
  worker: {
    themeClass: 'worker-theme',
  },
} satisfies Record<AppArea, { themeClass: string }>;

const workerRoutes = [
  '/worker',
  '/worker/history',
  '/worker/reports',
  '/worker/notifications',
  '/worker/profile',
];

export default function AppShell({ area, children }: { area: AppArea; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const drawerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const touchStart = useRef<{ x: number; y: number; fromRightEdge: boolean; ignored: boolean } | null>(null);
  const config = areaConfig[area];
  const renderSidebar = (onNavigate?: () => void) =>
    area === 'owner' ? (
      <Sidebar onNavigate={onNavigate} />
    ) : (
      <WorkerSidebar onNavigate={onNavigate} />
    );

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      if (mq.matches) setOpen(false);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  const startTouch = (event: React.PointerEvent) => {
    if (event.pointerType !== 'touch' || window.innerWidth >= 768) return;
    const target = event.target as HTMLElement;
    touchStart.current = {
      x: event.clientX,
      y: event.clientY,
      fromRightEdge: window.innerWidth - event.clientX <= 28,
      ignored: Boolean(target.closest('a, button, input, select, textarea, [data-swipe-navigation="ignore"]')),
    };
  };

  const finishTouch = (event: React.PointerEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || start.ignored || event.pointerType !== 'touch' || area !== 'worker') return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;

    if (start.fromRightEdge && deltaX < 0) {
      setOpen(true);
      return;
    }
    if (start.x <= 28) return;

    const currentIndex = workerRoutes.findIndex((route) =>
      route === '/worker' ? pathname === route : pathname === route || pathname.startsWith(`${route}/`),
    );
    if (currentIndex < 0) return;
    const nextIndex = deltaX < 0 ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex >= 0 && nextIndex < workerRoutes.length) router.push(workerRoutes[nextIndex]);
  };

  const closeDrawerWithSwipe = (event: React.PointerEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || event.pointerType !== 'touch') return;
    if (event.clientX - start.x > 56 && Math.abs(event.clientY - start.y) < 80) setOpen(false);
  };

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
    <div className={`${config.themeClass} flex h-screen overflow-x-hidden bg-[var(--color-background)]`} dir="rtl">
      <div
        className={`relative hidden h-screen shrink-0 transition-[width] duration-200 md:block ${
          desktopSidebarCollapsed ? 'w-0' : 'w-[220px]'
        }`}
      >
        <div className={`h-full w-[220px] overflow-hidden transition-transform duration-200 ${desktopSidebarCollapsed ? 'translate-x-full' : 'translate-x-0'}`}>
          {renderSidebar()}
        </div>
        <button
          type="button"
          onClick={() => setDesktopSidebarCollapsed((collapsed) => !collapsed)}
          aria-label={desktopSidebarCollapsed ? 'פתיחת תפריט צד' : 'סגירת תפריט צד'}
          aria-expanded={!desktopSidebarCollapsed}
          className="absolute left-0 top-5 z-40 inline-flex h-9 w-7 -translate-x-full items-center justify-center rounded-l-md border border-r-0 border-[var(--color-border-strong)] bg-[var(--color-background)] text-gray-600 shadow-sm hover:text-primary-700"
        >
          {desktopSidebarCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <div
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        className={`fixed inset-y-0 right-0 z-50 w-72 max-w-[86%] transform pt-[env(safe-area-inset-top)] transition-transform duration-200 ease-out md:hidden ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="תפריט ניווט"
        aria-hidden={!open}
        onPointerDown={startTouch}
        onPointerUp={closeDrawerWithSwipe}
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
        {renderSidebar(() => setOpen(false))}
      </div>

      <div ref={mainRef} className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[color:var(--color-surface)]/95 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <div className="flex h-16 items-center gap-3 px-4">
            <button
              type="button"
              ref={hamburgerRef}
              onClick={() => setOpen(true)}
              aria-label="פתיחת תפריט"
              aria-expanded={open}
              className="-mr-1 flex h-11 w-11 items-center justify-center rounded-xl text-gray-700 transition-colors hover:bg-white"
            >
              <Menu className="h-6 w-6" />
            </button>
            <BrandLockup area={area} compact />
          </div>
        </header>

        <main
          className="app-main flex-1 touch-pan-y overflow-y-auto overflow-x-hidden"
          onPointerDown={startTouch}
          onPointerUp={finishTouch}
        >
          <div className="mx-auto w-full max-w-[1440px] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
