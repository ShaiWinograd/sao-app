'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { canViewReports } from '../../lib/viewer-access';
import { useViewerRole } from '../../lib/use-viewer-role';
import RoleSwitcher from './RoleSwitcher';
import { BrandLockup } from './BrandLockup';

// Owner primary navigation (spec §5.1). Projects are an internal grouping
// entity only (§10) and are not a top-level destination. Worker/monthly reports
// and the customer report live under Reports and deep links.
const navItems = [
  { href: '/dashboard', label: 'בית', matchPrefix: '/dashboard' },
  { href: '/workers', label: 'עובדים', matchPrefix: '/workers' },
  { href: '/customers', label: 'לקוחות', matchPrefix: '/customers' },
  { href: '/reports', label: 'דוחות', matchPrefix: '/reports' },
  { href: '/settings', label: 'הגדרות', matchPrefix: '/settings' },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const viewerRole = useViewerRole();
  const showReports = canViewReports(viewerRole);
  const pathname = usePathname();
  const visibleNavItems = navItems.filter((item) => item.href !== '/reports' || showReports);

  return (
    <aside className="flex h-screen w-full flex-col overflow-hidden border-l border-[var(--color-border-strong)] bg-[var(--color-background)]">
      {/* Logo */}
      <div className="border-b border-[var(--color-border)] px-5 py-6">
        <BrandLockup area="owner" onNavigate={onNavigate} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-5 py-5">
        {visibleNavItems.map(({ href, label, matchPrefix }) => {
          const isActive =
            pathname === href || (matchPrefix !== '/dashboard' && pathname.startsWith(matchPrefix));
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
            'מה לחצתי:\n\nמה ציפיתי שיקרה:\n\nמה קרה בפועל:\n\nצילום מסך (אם אפשר):\n'
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
            appearance={{
              elements: {
                rootBox: 'flex-shrink-0',
                userButtonAvatarBox: 'w-8 h-8 rounded-lg',
              },
            }}
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
