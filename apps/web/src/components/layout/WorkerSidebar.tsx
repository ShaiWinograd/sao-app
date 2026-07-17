'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import {
  CalendarDays, CalendarCheck, BarChart3, User, Bell, History, Bug,
} from 'lucide-react';
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

export default function WorkerSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-white border-l border-gray-200 flex flex-col h-screen overflow-hidden shadow-sm no-print">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg overflow-hidden border border-gray-200 bg-white flex items-center justify-center">
            <Image src="/so-logo.jpg" alt="Space and Order" width={40} height={40} className="object-cover" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">S&amp;O</h1>
            <p className="text-xs text-gray-500">אזור העובדות</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {navItems.map(({ href, label, icon: Icon, exact }) => {
          const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-colors ${
                isActive
                  ? 'bg-primary-100 text-primary-700 font-semibold'
                  : 'font-medium text-gray-600 hover:bg-primary-50 hover:text-primary-700'
              }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary-600' : 'text-gray-400'}`} />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Report a bug / request */}
      <div className="px-2 py-2 border-t border-gray-100">
        <a
          href={`mailto:shaiwinograd@gmail.com?subject=${encodeURIComponent('Space & Order - משוב מהאפליקציה')}&body=${encodeURIComponent(
            'מה לחצתי:\n\nמה ציפיתי שיקרה:\n\nמה קרה בפועל:\n\nצילום מסך (אם אפשר):\n',
          )}`}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-gray-600 hover:bg-primary-50 hover:text-primary-700 transition-colors"
        >
          <Bug className="w-4 h-4 flex-shrink-0 text-gray-400" />
          <span className="truncate">דיווח באג או בקשה</span>
        </a>
      </div>

      {/* User Profile */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center gap-3">
          <UserButton
            afterSignOutUrl="/sign-in"
            appearance={{ elements: { rootBox: 'flex-shrink-0', userButtonAvatarBox: 'w-8 h-8 rounded-lg' } }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-900 truncate">החשבון שלי</p>
            <RoleSwitcher />
          </div>
        </div>
      </div>
    </aside>
  );
}
