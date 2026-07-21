'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { FileText, Users, ChevronLeft } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';

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
    <div className="p-6 max-w-3xl" dir="rtl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
        <FileText className="w-6 h-6 text-primary-600" />
        דוחות
      </h1>
      <p className="text-sm text-gray-500 mb-6">בחרו את סוג הדוח.</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/reports/customer"
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:border-primary-300"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary-600" />
              דוחות לקוחות
            </h2>
            <ChevronLeft className="w-4 h-4 text-gray-400" />
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
          className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:border-primary-300"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-primary-600" />
              דוחות חודשיים לעובדות
            </h2>
            <ChevronLeft className="w-4 h-4 text-gray-400" />
          </div>
          <p className="mt-2 text-sm text-gray-500">
            טיוטות חודשיות, גרסאות שפורסמו, בקשות תיקון והורדת PDF.
          </p>
        </Link>
      </div>
    </div>
  );
}
