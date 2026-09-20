'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import {
  CalendarDays, CalendarCheck, BarChart3, User, Bell, History, Bug,
} from 'lucide-react';
import RoleSwitcher from './RoleSwitcher';
import { BrandLockup } from './BrandLockup';

// Worker navigation (worker_web_spec §1). "משמרות" is the consolidated board
// (general + my shifts as tabs).
const navItems = [
  { href: '/worker', label: 'משמרות', icon: CalendarDays, exact: true },
  { href: '/worker/history', label: 'היסטוריית עבודות', icon: History },
  { href: '/worker/availability', label: 'הזמינות שלי', icon: CalendarCheck },
  { href: '/worker/reports', label: 'הדוחות שלי', icon: BarChart3 },
  { href: '/worker/notifications', label: 'התראות', icon: Bell },
  { href: '/worker/profile', label: 'הפרופיל שלי', icon: User },
];

export default function WorkerSidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();

  return (
    <aside className="no-print flex h-full w-full flex-col overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-surface-muted)]">
      {/* Logo */}
      <div className="border-b border-[var(--color-border)] px-5 py-5">
        <BrandLockup area="worker" onNavigate={onNavigate} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
        {navItems.map(({ href, label, icon: Icon, exact }) => {
          const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg border-r-2 px-3.5 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'border-primary-500 bg-primary-50 font-semibold text-primary-800'
                  : 'border-transparent font-medium text-gray-600 hover:bg-[var(--color-surface)] hover:text-primary-700'
              }`}
            >
              <Icon className={`h-5 w-5 flex-shrink-0 ${isActive ? 'text-primary-600' : 'text-gray-400'}`} />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Report a bug / request */}
      <div className="border-t border-[var(--color-border)] px-3 py-3">
        <a
          href={`mailto:shaiwinograd@gmail.com?subject=${encodeURIComponent('Space & Order - משוב מהאפליקציה')}&body=${encodeURIComponent(
            'מה לחצתי:\n\nמה ציפיתי שיקרה:\n\nמה קרה בפועל:\n\nצילום מסך (אם אפשר):\n',
          )}`}
          className="flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-white hover:text-primary-700"
        >
          <Bug className="w-4 h-4 flex-shrink-0 text-gray-400" />
          <span className="truncate">דיווח באג או בקשה</span>
        </a>
      </div>

      {/* User Profile */}
      <div className="border-t border-[var(--color-border)] p-4">
        <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <UserButton
            afterSignOutUrl="/sign-in"
            appearance={{ elements: { rootBox: 'flex-shrink-0', userButtonAvatarBox: 'w-8 h-8 rounded-lg' } }}
          />
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold text-gray-900">החשבון שלי</p>
            <RoleSwitcher />
          </div>
        </div>
      </div>
    </aside>
  );
}
