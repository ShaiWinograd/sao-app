'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { AlertTriangle, CalendarOff, Trash2 } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import { PageHeader } from '../../../components/ui/PageHeader';

type BlockType = 'DATE' | 'RANGE' | 'WEEKLY';
type Block = {
  id: string;
  type: BlockType;
  startDate?: string | null;
  endDate?: string | null;
  weekday?: number | null;
  reason?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const REASONS = ['חופש', 'חו״ל', 'חולה', 'אחר'] as const;

type Conflict = {
  shiftId: string;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  jobType: string;
  customerName: string;
  replacementStatus?: string;
};

function fmt(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

function describe(b: Block): string {
  const hours = b.startTime && b.endTime ? ` · ${b.startTime}–${b.endTime}` : ' · כל היום';
  if (b.type === 'WEEKLY') return `כל יום ${WEEKDAYS[b.weekday ?? 0]}${hours}`;
  if (b.type === 'RANGE') return `${fmt(b.startDate)} – ${fmt(b.endDate)}${hours}`;
  return `${fmt(b.startDate)}${hours}`;
}

export default function WorkerAvailabilityPage() {
  const { getToken } = useAuth();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('חופש');
  const [otherReason, setOtherReason] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const load = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<Block[]>('/workers/me/availability', auth);
      setBlocks(res.data ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async () => {
    setMessage(null);
    setConflicts([]);
    if (!startDate || !endDate) {
      setMessage('יש לבחור תאריך התחלה ותאריך סיום.');
      return;
    }
    if (endDate < startDate) {
      setMessage('יש לבחור טווח תאריכים תקין.');
      return;
    }
    if (!allDay && startDate !== endDate) {
      setMessage('טווח שעות זמין כרגע לתאריך בודד. לטווח תאריכים יש לבחור יום מלא.');
      return;
    }
    if (!allDay && startTime >= endTime) {
      setMessage('שעת הסיום חייבת להיות מאוחרת משעת ההתחלה.');
      return;
    }
    if (reason === 'אחר' && !otherReason.trim()) {
      setMessage('יש לפרט את הסיבה.');
      return;
    }
    setBusy(true);
    try {
      const auth = await authHeaders(getToken);
      const type: BlockType = startDate === endDate ? 'DATE' : 'RANGE';
      await api.post(
        '/workers/me/availability',
        {
          type,
          startDate,
          endDate: type === 'RANGE' ? endDate : undefined,
          startTime: allDay ? undefined : startTime,
          endTime: allDay ? undefined : endTime,
          reason: reason === 'אחר' ? otherReason.trim() : reason,
        },
        auth,
      );
      setStartDate('');
      setEndDate('');
      setAllDay(true);
      setReason('חופש');
      setOtherReason('');
      await load();
    } catch (err) {
      const data = (err as {
        response?: { data?: { error?: string; message?: string; conflicts?: Conflict[] } };
      })?.response?.data;
      if (data?.error === 'AVAILABILITY_CONFLICT' && data.conflicts?.length) {
        setConflicts(data.conflicts);
      } else {
        setMessage(data?.message ?? 'לא ניתן היה לשמור. נסי שוב.');
      }
    } finally {
      setBusy(false);
    }
  }, [allDay, endDate, endTime, getToken, load, otherReason, reason, startDate, startTime]);

  const remove = useCallback(
    async (id: string) => {
      setBlocks((prev) => prev.filter((b) => b.id !== id));
      try {
        const auth = await authHeaders(getToken);
        await api.delete(`/workers/me/availability/${id}`, auth);
      } catch {
        void load();
      }
    },
    [getToken, load],
  );

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  const today = new Date().toLocaleDateString('en-CA');

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6">
      <PageHeader
        eyebrow="MAKE ROOM FOR YOUR PLANS"
        title="זמן לעבוד. זמן לעצמך"
        description="סמני מתי אינך פנויה, כדי שנוכל לתכנן יחד."
        icon={<CalendarOff className="h-6 w-6" />}
      />

      {error ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm text-gray-500">לא נמצא פרופיל עובד/ת לחשבון זה.</p>
      ) : (
        <>
          <div className="space-y-5 border-y border-[var(--color-border)] bg-[var(--color-surface-muted)] px-5 py-6 sm:px-7">
            <h2 className="font-display text-2xl font-medium text-gray-900">מתי לא תהיי זמינה?</h2>
            <div className="grid gap-4 border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">
                התחלה
                <input
                  type="date"
                  min={today}
                  value={startDate}
                  onChange={(event) => {
                    const value = event.target.value;
                    setStartDate(value);
                    if (!endDate || endDate < value) setEndDate(value);
                  }}
                  className="mt-1 block w-full border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm font-medium text-gray-700">
                סיום
                <input
                  type="date"
                  min={startDate || today}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="mt-1 block w-full border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
                  className="h-4 w-4 accent-primary-700"
                />
                כל היום
              </label>
              {!allDay && (
                <>
                  <label className="text-sm font-medium text-gray-700">
                    שעת התחלה
                    <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1 block w-full border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                  <label className="text-sm font-medium text-gray-700">
                    שעת סיום
                    <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-1 block w-full border border-gray-300 px-3 py-2 text-sm" />
                  </label>
                </>
              )}
              <label className="text-sm font-medium text-gray-700 sm:col-span-2">
                סיבה
                <select
                  value={reason}
                  onChange={(event) => setReason(event.target.value as (typeof REASONS)[number])}
                  className="mt-1 block w-full border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm"
                >
                  {REASONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              {reason === 'אחר' && (
                <label className="text-sm font-medium text-gray-700 sm:col-span-2">
                  פירוט
                  <input value={otherReason} onChange={(event) => setOtherReason(event.target.value)} className="mt-1 block w-full border border-gray-300 px-3 py-2 text-sm" />
                </label>
              )}
              <button
                type="button"
                onClick={() => void add()}
                disabled={busy}
                className="bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-50 sm:col-span-2"
              >
                שמירת אי-זמינות
              </button>
            </div>
            {message && <p className="text-xs text-rose-600">{message}</p>}
          </div>

          {/* Existing blocks */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl font-medium text-gray-900">אי-הזמינות שלך</h2>
              <span className="text-xs text-[var(--color-text-muted)]">{blocks.length} חסימות</span>
            </div>
            {blocks.length === 0 ? (
              <div className="border-y border-[var(--color-border)] p-8 text-center">
                <CalendarOff className="mx-auto w-6 h-6 text-gray-300" />
                <p className="mt-1.5 text-sm text-gray-500">לא הוגדרו חסימות. את זמינה לכל העבודות.</p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                {blocks.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 px-2 py-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{describe(b)}</p>
                      {b.reason && <p className="text-xs text-gray-500 mt-0.5">{b.reason}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void remove(b.id)}
                      aria-label="הסרה"
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {conflicts.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-3 sm:items-center" dir="rtl">
          <div role="dialog" aria-modal="true" aria-label="התנגשות עם משמרת" className="w-full max-w-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">כבר יש לך משמרת בזמן הזה</h2>
                <p className="mt-1 text-sm text-gray-600">יש למצוא מחליפה לפני שניתן יהיה לשמור את אי-הזמינות.</p>
              </div>
            </div>
            <div className="mt-4 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
              {conflicts.map((conflict) => (
                <div key={conflict.shiftId} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{conflict.customerName}</p>
                    <p className="mt-1 text-xs text-gray-600">
                      {fmt(conflict.date)} · {new Date(conflict.plannedStart).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}–{new Date(conflict.plannedEnd).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <Link
                    href={`/worker?replacementShiftId=${conflict.shiftId}`}
                    className="shrink-0 border border-primary-700 px-3 py-2 text-xs font-semibold text-primary-800 hover:bg-primary-50"
                  >
                    {conflict.replacementStatus === 'PENDING' ? 'צפייה בבקשה' : 'בקשת מחליפה'}
                  </Link>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => setConflicts([])} className="mt-4 w-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              חזרה לעריכה
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
