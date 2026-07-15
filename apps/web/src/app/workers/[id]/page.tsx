'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import { StatusBadge } from '../../../components/ui/StatusBadge';

type WorkerShift = {
  id: string;
  attendanceStatus: string;
  scheduledStart?: string | null;
  job?: { date: string; jobType: string } | null;
};

type WorkerAdjustment = {
  id: string;
  amount: number | string;
  reason?: string | null;
  createdAt: string;
};

type WorkerPayment = {
  id: string;
  amount: number | string;
  status?: string | null;
  createdAt: string;
};

type WorkerDetail = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paymentMethod: string;
  skills: string[];
  isActive: boolean;
  homeArea?: string | null;
  notes?: string | null;
  shifts: WorkerShift[];
  adjustments: WorkerAdjustment[];
  workerPayments: WorkerPayment[];
};

type WorkerTab = 'details' | 'availability' | 'jobs' | 'attendance' | 'payments';

const JOB_TYPE_LABELS: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

const ATTENDANCE_LABELS: Record<string, string> = {
  SCHEDULED: 'טרם החל',
  CLOCKED_IN: 'נכנס',
  CLOCKED_OUT: 'סיים',
  AUTO_CLOCKED_OUT: 'סיים (אוטומטי)',
  CORRECTED: 'תוקן ידנית',
  NO_SHOW: 'לא הגיע',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('he-IL');
}

function formatCurrency(value: number | string): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(amount)) return '—';
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function WorkerDetailPage() {
  const params = useParams<{ id: string }>();
  const workerId = params?.id;
  const { getToken } = useAuth();

  const [tab, setTab] = useState<WorkerTab>('details');
  const [worker, setWorker] = useState<WorkerDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workerId) return;
    setIsLoading(true);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<WorkerDetail>(`/workers/${workerId}`, auth);
      setWorker(res.data);
    } catch {
      setError('טעינת פרטי העובד נכשלה');
    } finally {
      setIsLoading(false);
    }
  }, [workerId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const upcomingShifts = useMemo(() => {
    if (!worker) return [];
    const todayKey = new Date().toISOString().slice(0, 10);
    return worker.shifts
      .filter((shift) => shift.job?.date && shift.job.date.slice(0, 10) >= todayKey)
      .sort((a, b) => new Date(a.job!.date).getTime() - new Date(b.job!.date).getTime());
  }, [worker]);

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500" dir="rtl">טוען…</div>;
  }
  if (!worker) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-sm text-gray-500">{error ?? 'העובד לא נמצא'}</p>
        <Link href="/workers" className="text-sm text-primary-600 mt-2 inline-block">חזרה לעובדים</Link>
      </div>
    );
  }

  return (
    <div className="p-6" dir="rtl">
      <Link href="/workers" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowRight className="w-4 h-4" />
        חזרה לעובדים
      </Link>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{worker.firstName} {worker.lastName}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{worker.phone} · {worker.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={worker.isActive ? 'success' : 'neutral'} label={worker.isActive ? 'פעיל' : 'לא פעיל'} />
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            רענון
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-danger-bg border border-danger/30 text-danger text-sm px-4 py-3">{error}</div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(
          [
            { key: 'details', label: 'פרטים' },
            { key: 'availability', label: 'זמינות' },
            { key: 'jobs', label: 'עבודות' },
            { key: 'attendance', label: 'נוכחות' },
            { key: 'payments', label: 'תשלומים' },
          ] as Array<{ key: WorkerTab; label: string }>
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm rounded-lg font-medium ${tab === t.key ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'details' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">פרטי העובד</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-gray-500">טלפון</dt><dd className="text-gray-900">{worker.phone}</dd></div>
            <div><dt className="text-gray-500">אימייל</dt><dd className="text-gray-900">{worker.email}</dd></div>
            <div><dt className="text-gray-500">אזור מגורים</dt><dd className="text-gray-900">{worker.homeArea || '—'}</dd></div>
            <div><dt className="text-gray-500">אופן תשלום</dt><dd className="text-gray-900">{worker.paymentMethod}</dd></div>
            <div className="col-span-2">
              <dt className="text-gray-500 mb-1">תפקיד</dt>
              <dd>
                <span className="inline-flex items-center rounded-full bg-primary-50 text-primary-700 px-2.5 py-0.5 text-xs">
                  {worker.skills.includes('SHIFT_LEADER') ? 'ראש צוות' : 'עובדת'}
                </span>
              </dd>
            </div>
            {worker.notes ? (
              <div className="col-span-2"><dt className="text-gray-500">הערות</dt><dd className="text-gray-900">{worker.notes}</dd></div>
            ) : null}
          </dl>
        </section>
      )}

      {tab === 'availability' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">שיבוצים קרובים</h2>
          {upcomingShifts.length === 0 ? (
            <p className="text-sm text-gray-400">אין שיבוצים עתידיים — העובד פנוי</p>
          ) : (
            <ul className="space-y-2">
              {upcomingShifts.map((shift) => (
                <li key={shift.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                  <span className="text-sm text-gray-800">{formatDate(shift.job?.date)}</span>
                  <StatusBadge tone="warning" label={`משובץ · ${JOB_TYPE_LABELS[shift.job?.jobType ?? ''] ?? shift.job?.jobType ?? ''}`} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'jobs' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">היסטוריית עבודות</h2>
          {worker.shifts.length === 0 ? (
            <p className="text-sm text-gray-400">אין עבודות משויכות לעובד זה</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {worker.shifts.map((shift) => (
                <li key={shift.id} className="py-2.5 flex items-center justify-between">
                  <span className="text-sm text-gray-800">
                    {JOB_TYPE_LABELS[shift.job?.jobType ?? ''] ?? shift.job?.jobType ?? '—'} · {formatDate(shift.job?.date)}
                  </span>
                  <span className="text-xs text-gray-500">{ATTENDANCE_LABELS[shift.attendanceStatus] ?? shift.attendanceStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'attendance' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">נוכחות</h2>
          {worker.shifts.length === 0 ? (
            <p className="text-sm text-gray-400">אין רשומות נוכחות</p>
          ) : (
            <ul className="space-y-2">
              {worker.shifts.map((shift) => (
                <li key={shift.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                  <span className="text-sm text-gray-800">{formatDate(shift.job?.date)}</span>
                  <span className="text-xs text-gray-500">{ATTENDANCE_LABELS[shift.attendanceStatus] ?? shift.attendanceStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'payments' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">תשלומים</h2>
            {worker.workerPayments.length === 0 ? (
              <p className="text-sm text-gray-400">אין תשלומים רשומים</p>
            ) : (
              <ul className="space-y-2">
                {worker.workerPayments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                    <span className="text-sm text-gray-800">{formatDate(payment.createdAt)}</span>
                    <span className="text-sm font-semibold text-gray-900">{formatCurrency(payment.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">התאמות</h2>
            {worker.adjustments.length === 0 ? (
              <p className="text-sm text-gray-400">אין התאמות</p>
            ) : (
              <ul className="space-y-2">
                {worker.adjustments.map((adjustment) => (
                  <li key={adjustment.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                    <span className="text-sm text-gray-800">{adjustment.reason || 'התאמה'} · {formatDate(adjustment.createdAt)}</span>
                    <span className="text-sm font-semibold text-gray-900">{formatCurrency(adjustment.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
