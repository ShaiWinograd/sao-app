'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { LayoutDashboard, Users, Calendar, BarChart3, Settings, Contact, Bug } from 'lucide-react';
import { canViewReports } from '../../lib/viewer-access';
import { useViewerRole } from '../../lib/use-viewer-role';
import RoleSwitcher from './RoleSwitcher';
import { BrandLockup } from './BrandLockup';

// Owner primary navigation (spec §5.1). Projects are an internal grouping
// entity only (§10) and are not a top-level destination. Worker/monthly reports
// and the customer report live under Reports and deep links.
const navItems = [
  { href: '/dashboard', label: 'בית', icon: LayoutDashboard, matchPrefix: '/dashboard' },
  { href: '/jobs', label: 'יומן עבודות', icon: Calendar, matchPrefix: '/jobs' },
  { href: '/workers', label: 'עובדים', icon: Users, matchPrefix: '/workers' },
  { href: '/customers', label: 'לקוחות', icon: Contact, matchPrefix: '/customers' },
  { href: '/reports', label: 'דוחות', icon: BarChart3, matchPrefix: '/reports' },
  { href: '/settings', label: 'הגדרות', icon: Settings, matchPrefix: '/settings' },
];

export default function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const viewerRole = useViewerRole();
  const showReports = canViewReports(viewerRole);
  const pathname = usePathname();
  const visibleNavItems = navItems.filter((item) => item.href !== '/reports' || showReports);

  return (
    <aside className="flex h-screen w-full flex-col overflow-hidden border-l border-[#e7e3dc] bg-[#fbfaf7]">
      {/* Logo */}
      <div className="border-b border-[#ebe7df] px-5 py-5">
        <BrandLockup area="owner" onNavigate={onNavigate} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
        {visibleNavItems.map(({ href, label, icon: Icon, matchPrefix }) => {
          const isActive =
            pathname === href || (matchPrefix !== '/dashboard' && pathname.startsWith(matchPrefix));
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all ${
                isActive
                  ? 'bg-primary-100 font-semibold text-primary-800'
                  : 'font-medium text-gray-600 hover:bg-white hover:text-primary-700'
              }`}
            >
              <Icon
                className={`h-5 w-5 flex-shrink-0 ${isActive ? 'text-primary-600' : 'text-gray-400'}`}
              />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Report a bug / request */}
      <div className="border-t border-[#ebe7df] px-3 py-3">
        <a
          href={`mailto:shaiwinograd@gmail.com?subject=${encodeURIComponent('Space & Order - משוב מהאפליקציה')}&body=${encodeURIComponent(
            'מה לחצתי:\n\nמה ציפיתי שיקרה:\n\nמה קרה בפועל:\n\nצילום מסך (אם אפשר):\n'
          )}`}
          className="flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-white hover:text-primary-700"
        >
          <Bug className="w-4 h-4 flex-shrink-0 text-gray-400" />
          <span className="truncate">דיווח באג או בקשה</span>
        </a>
      </div>

      {/* User Profile */}
      <div className="border-t border-[#ebe7df] p-4">
        <div className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-[0_2px_8px_rgba(38,38,38,0.05)]">
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
