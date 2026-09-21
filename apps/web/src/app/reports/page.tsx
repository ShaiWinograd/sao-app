'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { FileText, Users, ChevronLeft } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';

type Overview = { ready: unknown[]; closed: unknown[] };

/**
 * Reports hub (main nav "דוחות"). Deliberately scoped to the two report types the
 * product supports — customer reports and monthly worker reports. It never shows
 * revenue / profit / balances / payments (those legacy management concepts live
 * behind the internal /reports/management route, off the primary nav).
 */
export default function ReportsHubPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [counts, setCounts] = useState<{ ready: number; closed: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<Overview>('/cases/reports-overview', auth);
      setCounts({ ready: res.data?.ready?.length ?? 0, closed: res.data?.closed?.length ?? 0 });
    } catch {
      setCounts(null);
    }
  }, [getToken]);

  // Load counts independently on mount + refresh (gated on Clerk readiness).
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setCounts(null);
      return;
    }
    void load();
  }, [isLoaded, isSignedIn, load]);

  return (
    <div className="max-w-5xl space-y-6" dir="rtl">
      <PageHeader
        eyebrow="A CLEAR VIEW OF THE WORK"
        title="דוחות"
        description="בחירה פשוטה בין דוחות הלקוחות לבין הסיכום החודשי של הצוות."
        icon={<FileText className="h-6 w-6" />}
      />

      <div className="grid border-y border-[var(--color-border)] sm:grid-cols-2 sm:divide-x sm:divide-x-reverse sm:divide-[var(--color-border)]">
        <Link
          href="/reports/customer"
          className="group border-b border-[var(--color-border)] p-6 transition-colors hover:bg-primary-50/40 sm:border-b-0"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary-600" />
              דוחות לקוחות
            </h2>
            <ChevronLeft className="h-4 w-4 text-gray-400 transition-transform group-hover:-translate-x-1" />
          </div>
          <p className="mt-2 text-sm text-gray-500">
            פרויקטים מוכנים לדוח, דוחות שהופקו, היסטוריית גרסאות והורדת PDF.
          </p>
          {counts && (
            <p className="mt-3 text-xs text-gray-600">
              {counts.ready} מוכנים · {counts.closed} הופקו
            </p>
          )}
        </Link>

        <Link
          href="/payroll"
          className="group p-6 transition-colors hover:bg-primary-50/40"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary-600" />
              דוחות חודשיים לעובדות
            </h2>
            <ChevronLeft className="h-4 w-4 text-gray-400 transition-transform group-hover:-translate-x-1" />
          </div>
          <p className="mt-2 text-sm text-gray-500">
            טיוטות חודשיות, גרסאות שפורסמו, בקשות תיקון והורדת PDF.
          </p>
        </Link>
      </div>
    </div>
  );
}
