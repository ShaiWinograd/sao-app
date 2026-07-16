'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ChevronRight, ChevronLeft, CalendarDays, Clock, Wallet } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';

type EarningsLine = { shiftId: string; date: string; customerName: string; approvedHours: number; pay: number };
type Adjustment = { id: string; amount: number; reason: string; category: string };
type Payment = { id: string; amount: number; paymentDate: string; method: string };
type Earnings = {
  month: number;
  year: number;
  shifts: EarningsLine[];
  adjustments: Adjustment[];
  payments: Payment[];
  summary: {
    shiftsCount: number;
    totalApprovedHours: number;
    hourlyPay: number;
    dailyPay: number;
    adjustmentTotal: number;
    totalDue: number;
    totalPaid: number;
    outstanding: number;
    status: string;
  };
};

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const STATUS_LABEL: Record<string, string> = {
  PAID: 'שולם',
  PARTIALLY_PAID: 'שולם חלקית',
  NOT_PREPARED: 'טרם הוכן',
};

const STATUS_CLASS: Record<string, string> = {
  PAID: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PARTIALLY_PAID: 'border-amber-200 bg-amber-50 text-amber-700',
  NOT_PREPARED: 'border-gray-200 bg-gray-50 text-gray-500',
};

function ils(n: number): string {
  return `₪${(n ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export default function WorkerReportsPage() {
  const { getToken } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<Earnings>(`/payroll/me?month=${month}&year=${year}`, auth);
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const step = useCallback(
    (delta: number) => {
      setData(null);
      const next = new Date(year, month - 1 + delta, 1);
      setMonth(next.getMonth() + 1);
      setYear(next.getFullYear());
    },
    [month, year],
  );

  const isCurrentOrFuture = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return first >= thisMonth;
  }, [month, year, now]);

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900">הדוחות שלי</h1>

      {/* Month navigation */}
      <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
        <button type="button" onClick={() => step(-1)} aria-label="חודש קודם" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-50">
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <CalendarDays className="w-4 h-4 text-gray-400" />
          {MONTHS[month - 1]} {year}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={isCurrentOrFuture}
          aria-label="חודש הבא"
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">טוען…</p>
      ) : error || !data ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">לא נמצא פרופיל עובד/ת לחשבון זה.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Wallet className="w-4 h-4 text-gray-400" />
                סיכום חודשי
              </h2>
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[data.summary.status] ?? STATUS_CLASS.NOT_PREPARED}`}>
                {STATUS_LABEL[data.summary.status] ?? data.summary.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="משמרות" value={String(data.summary.shiftsCount)} />
              <Stat label="שעות מאושרות" value={`${data.summary.totalApprovedHours}`} icon={<Clock className="w-3.5 h-3.5" />} />
              <Stat label="תשלום שעתי" value={ils(data.summary.hourlyPay)} />
              <Stat label="תשלום יומי" value={ils(data.summary.dailyPay)} />
              {data.summary.adjustmentTotal !== 0 && <Stat label="התאמות" value={ils(data.summary.adjustmentTotal)} />}
              <Stat label="סה״כ מגיע" value={ils(data.summary.totalDue)} strong />
              <Stat label="שולם" value={ils(data.summary.totalPaid)} />
              <Stat label="יתרה לתשלום" value={ils(data.summary.outstanding)} strong />
            </div>
          </div>

          {/* Shifts */}
          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-2">משמרות</h2>
            {data.shifts.length === 0 ? (
              <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">אין משמרות שהושלמו בחודש זה.</p>
            ) : (
              <div className="space-y-2">
                {data.shifts.map((s) => (
                  <div key={s.shiftId} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.customerName || 'לקוח/ה'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{fmtDate(s.date)} · {s.approvedHours} שעות</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{ils(s.pay)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Adjustments */}
          {data.adjustments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">התאמות</h2>
              <div className="space-y-2">
                {data.adjustments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-sm text-gray-700">{a.reason}</p>
                    <span className={`text-sm font-semibold ${a.amount < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{ils(a.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Payments */}
          {data.payments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">תשלומים שהתקבלו</h2>
              <div className="space-y-2">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-xs text-gray-500">{fmtDate(p.paymentDate)}</p>
                    <span className="text-sm font-semibold text-emerald-700">{ils(p.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon, strong }: { label: string; value: string; icon?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] text-gray-500">
        {icon}
        {label}
      </p>
      <p className={`mt-0.5 ${strong ? 'text-base font-bold text-gray-900' : 'text-sm font-medium text-gray-800'}`}>{value}</p>
    </div>
  );
}
