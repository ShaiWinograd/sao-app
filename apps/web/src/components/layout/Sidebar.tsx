'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { UserButton, useUser } from '@clerk/nextjs';
import {
  LayoutDashboard, Users, Calendar, BarChart3, Settings, LayoutGrid, Contact,
} from 'lucide-react';
import { canViewReports, resolveAppViewerRole } from '../../lib/viewer-access';

// Spec 02 (navigation): only these seven top-level items. Quotations, Forms,
// Attendance, Messages, and Payments must NOT be top-level — they live inside
// projects and surface as dashboard tasks (their routes still exist for deep links).
const navItems = [
  { href: '/dashboard', label: 'בית', icon: LayoutDashboard, matchPrefix: '/dashboard' },
  { href: '/cases/board', label: 'פרויקטים', icon: LayoutGrid, matchPrefix: '/cases' },
  { href: '/jobs', label: 'יומן עבודות', icon: Calendar, matchPrefix: '/jobs' },
  { href: '/workers', label: 'עובדים', icon: Users, matchPrefix: '/workers' },
  { href: '/customers', label: 'לקוחות', icon: Contact, matchPrefix: '/customers' },
  { href: '/reports', label: 'דוחות', icon: BarChart3, matchPrefix: '/reports' },
  { href: '/settings', label: 'הגדרות', icon: Settings, matchPrefix: '/settings' },
];

export default function Sidebar() {
  const { user } = useUser();
  const viewerRole = resolveAppViewerRole(user);
  const showReports = canViewReports(viewerRole);
  const pathname = usePathname();
  const visibleNavItems = navItems.filter((item) => item.href !== '/reports' || showReports);

  return (
    <aside className="w-56 bg-white border-l border-gray-200 flex flex-col h-screen overflow-hidden shadow-sm">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg overflow-hidden border border-gray-200 bg-white flex items-center justify-center">
            <Image src="/so-logo.jpg" alt="Space and Order" width={40} height={40} className="object-cover" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900">S&amp;O</h1>
            <p className="text-xs text-gray-500">ניהול עסק</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {visibleNavItems.map(({ href, label, icon: Icon, matchPrefix }) => {
          const isActive =
            pathname === href ||
            (matchPrefix !== '/dashboard' && pathname.startsWith(matchPrefix));
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
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary-600' : 'text-gray-400'}`}
              />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center gap-3">
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
            <p className="text-xs font-semibold text-gray-900 truncate">החשבון שלי</p>
            <p className="text-xs text-gray-500">בעלי עסק</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
