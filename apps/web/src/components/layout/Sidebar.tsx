'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { UserButton, useUser } from '@clerk/nextjs';
import { HE } from '@workforce/shared';
import {
  LayoutDashboard, Users, Briefcase, Calendar, ClipboardList,
  FileText, Wallet, BarChart3, Settings, ScrollText, ReceiptText, LayoutGrid,
} from 'lucide-react';
import { canViewReports, resolveAppViewerRole } from '../../lib/viewer-access';

const navItems = [
  { href: '/dashboard', label: HE.nav.dashboard, icon: LayoutDashboard },
  { href: '/customers', label: HE.nav.customers, icon: Users },
  { href: '/cases', label: HE.nav.customerCase, icon: Briefcase },
  { href: '/cases/board', label: HE.nav.projectBoard, icon: LayoutGrid },
  { href: '/quotations', label: HE.nav.quotations, icon: ReceiptText },
  { href: '/jobs', label: HE.nav.jobs, icon: Calendar },
  { href: '/workers', label: HE.nav.workers, icon: Users },
  { href: '/attendance', label: HE.nav.attendance, icon: ClipboardList },
  { href: '/forms', label: HE.nav.forms, icon: FileText },
  { href: '/payroll', label: HE.nav.workerPayroll, icon: Wallet },
  { href: '/reports', label: HE.nav.reports, icon: BarChart3 },
  { href: '/settings', label: HE.nav.settings, icon: Settings },
  { href: '/audit', label: HE.nav.auditLog, icon: ScrollText },
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
        {visibleNavItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all ${
                isActive
                  ? 'text-primary-600 bg-primary-50 border-b-2 border-primary-600'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
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
