'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { CalendarDays, CalendarCheck, BarChart3, User, Bell, History, Bug } from 'lucide-react';
import RoleSwitcher from './RoleSwitcher';

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
    <aside className="no-print flex h-full w-full flex-col overflow-hidden border-l border-[#e7e3dc] bg-[#fbfaf7]">
      {/* Logo */}
      <div className="border-b border-[#ebe7df] px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-[#e7e3dc] bg-white shadow-sm">
            <Image
              src="/so-logo.jpg"
              alt="Space and Order"
              width={40}
              height={40}
              className="object-cover"
            />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-gray-900">S&amp;O</h1>
            <p className="text-sm text-gray-500">אזור העובדות</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
        {navItems.map(({ href, label, icon: Icon, exact }) => {
          const isActive = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-all ${
                isActive
                  ? 'bg-primary-100 font-semibold text-primary-800 shadow-[inset_-3px_0_0_rgb(var(--tw-primary-600))]'
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
              elements: { rootBox: 'flex-shrink-0', userButtonAvatarBox: 'w-8 h-8 rounded-lg' },
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
