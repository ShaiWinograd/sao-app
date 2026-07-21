'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { FileText, CheckCircle2, Loader2, Archive } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';

type ReadyCase = { caseId: string; customerName: string; jobCount: number; latestJobDate: string | null };
type ClosedCase = { caseId: string; customerName: string; latestVersion: number; finalAmount: number | null; updatedAt: string };
type Overview = { ready: ReadyCase[]; closed: ClosedCase[] };

function money(n: number | null): string {
  return n == null ? '—' : `${Number(n).toLocaleString('he-IL')} ₪`;
}

export default function CustomerReportsHubPage() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<Overview>('/cases/reports-overview', auth);
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  // Fetch independently once Clerk auth is ready. Gating on isLoaded makes the
  // page work on DIRECT navigation and a full browser refresh (not only when
  // arriving via client-side navigation from Home, where auth was already warm).
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setData(null);
      setLoading(false);
      return;
    }
    void load();
  }, [isLoaded, isSignedIn, load]);

  return (
    <div className="p-6 max-w-3xl" dir="rtl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
        <FileText className="w-6 h-6 text-primary-600" />
        דוחות לקוחה
      </h1>
      <p className="text-sm text-gray-500 mb-5">פרויקטים שמוכנים להפקת דוח, ודוחות שכבר הופקו.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> טוען…</div>
      ) : (
        <>
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-green-600" /> מוכנים לדוח ({data?.ready.length ?? 0})
            </h2>
            {(data?.ready.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-400">אין פרויקטים מוכנים כרגע.</p>
            ) : (
              <ul className="space-y-2">
                {data!.ready.map((c) => (
                  <li key={c.caseId}>
                    <Link
                      href={`/cases/${c.caseId}/customer-report`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-primary-300"
                    >
                      <span className="font-medium text-gray-900">{c.customerName || 'לקוח'}</span>
                      <span className="text-xs text-gray-500">{c.jobCount} עבודות · עד {c.latestJobDate ?? '—'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
              <Archive className="w-4 h-4 text-gray-500" /> דוחות שהופקו ({data?.closed.length ?? 0})
            </h2>
            {(data?.closed.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-400">עדיין לא הופקו דוחות.</p>
            ) : (
              <ul className="space-y-2">
                {data!.closed.map((c) => (
                  <li key={c.caseId}>
                    <Link
                      href={`/cases/${c.caseId}/customer-report`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 hover:border-primary-300"
                    >
                      <span className="font-medium text-gray-900">{c.customerName || 'לקוח'}</span>
                      <span className="text-xs text-gray-500">גרסה {c.latestVersion} · {money(c.finalAmount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
