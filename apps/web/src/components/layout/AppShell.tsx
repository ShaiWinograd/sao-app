'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';
import WorkerSidebar from './WorkerSidebar';

type AppArea = 'owner' | 'worker';

const areaConfig = {
  owner: {
    label: 'ניהול עסק',
    themeClass: '',
  },
  worker: {
    label: 'אזור העובדות',
    themeClass: 'worker-theme',
  },
} satisfies Record<AppArea, { label: string; themeClass: string }>;

export default function AppShell({ area, children }: { area: AppArea; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const drawerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
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
    <div className={`${config.themeClass} flex h-screen overflow-x-hidden bg-[#f7f6f2]`} dir="rtl">
      <div className="hidden h-screen w-[240px] shrink-0 md:block">{renderSidebar()}</div>

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
        <header className="sticky top-0 z-30 border-b border-[#e7e3dc] bg-[#fbfaf7]/95 pt-[env(safe-area-inset-top)] shadow-[0_1px_8px_rgba(38,38,38,0.04)] backdrop-blur md:hidden">
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
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
                <Image
                  src="/so-logo.jpg"
                  alt="Space and Order"
                  width={32}
                  height={32}
                  className="object-cover"
                />
              </div>
              <span className="text-base font-bold text-gray-900">S&amp;O · {config.label}</span>
            </div>
          </div>
        </header>

        <main className="app-main flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1440px] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
