'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import RoleSwitcher from './RoleSwitcher';
import { BrandLockup } from './BrandLockup';

// Worker navigation (worker_web_spec §1). "יומן" is the consolidated board
// (general + my shifts as tabs).
const navItems = [
  { href: '/worker', label: 'יומן', exact: true },
  { href: '/worker/history', label: 'היסטוריית עבודות' },
  { href: '/worker/reports', label: 'הדוחות שלי' },
  { href: '/worker/notifications', label: 'התראות' },
  { href: '/worker/profile', label: 'הפרופיל שלי' },
];

export default function WorkerSidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();

  return (
    <aside className="no-print flex h-full w-full flex-col overflow-hidden border-l border-[var(--color-border-strong)] bg-[var(--color-background)]">
      {/* Logo */}
      <div className="border-b border-[var(--color-border)] px-5 py-6">
        <BrandLockup area="worker" onNavigate={onNavigate} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-5 py-5">
        {navItems.map(({ href, label, exact }) => {
          const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-12 items-center border-b border-[var(--color-border)] border-r-2 px-3 py-3 text-sm transition-colors ${
                isActive
                  ? 'border-r-primary-600 font-semibold text-primary-800'
                  : 'border-r-transparent font-medium text-gray-600 hover:text-primary-700'
              }`}
            >
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Report a bug / request */}
      <div className="border-t border-[var(--color-border)] px-5 py-2">
        <a
          href={`mailto:shaiwinograd@gmail.com?subject=${encodeURIComponent('Space & Order - משוב מהאפליקציה')}&body=${encodeURIComponent(
            'מה לחצתי:\n\nמה ציפיתי שיקרה:\n\nמה קרה בפועל:\n\nצילום מסך (אם אפשר):\n',
          )}`}
          className="flex min-h-11 items-center px-2 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:text-primary-700"
        >
          <span className="truncate">דיווח באג או בקשה</span>
        </a>
      </div>

      {/* User Profile */}
      <div className="border-t border-[var(--color-border)] px-5 py-4">
        <div className="flex items-center gap-3 px-2">
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
