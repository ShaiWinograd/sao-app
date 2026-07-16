'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, Repeat } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';

const JOB_TYPE_LABEL: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

type SwapShift = {
  date: string;
  plannedStart: string;
  plannedEnd: string;
  jobType: string;
  customerName: string;
};

type PendingSwap = {
  id: string;
  note: string | null;
  fromWorkerName: string;
  toWorkerName: string;
  fromShift: SwapShift;
  toShift: SwapShift;
};

type DateShift = {
  shiftId: string;
  workerName: string;
  plannedStart: string;
  plannedEnd: string;
  jobType: string;
  customerName: string;
};

function jobTypeLabel(t: string): string {
  return JOB_TYPE_LABEL[t] ?? t;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function shiftLabel(s: SwapShift): string {
  const d = new Date(s.date).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return `${d} · ${jobTypeLabel(s.jobType)} · ${formatTime(s.plannedStart)}–${formatTime(s.plannedEnd)} · ${s.customerName}`;
}

export default function OwnerSwapApprovalsPage() {
  const { getToken } = useAuth();
  const [swaps, setSwaps] = useState<PendingSwap[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<PendingSwap[]>('/shifts/swaps/pending-owner', auth);
      setSwaps(res.data ?? []);
    } catch {
      setSwaps([]);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = useCallback(
    async (id: string, approved: boolean, override = false) => {
      setBusyId(id);
      setMsg(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/swaps/${id}/resolve`, { approved, override }, auth);
        await load();
      } catch (err) {
        const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
        if (data?.error === 'team_leader_coverage' && data.message) {
          if (window.confirm(data.message)) {
            await resolve(id, approved, true);
            return;
          }
        } else {
          setMsg(data?.error ? `הפעולה נכשלה: ${data.error}` : 'הפעולה נכשלה.');
        }
      } finally {
        setBusyId(null);
      }
    },
    [getToken, load],
  );

  const [swapDate, setSwapDate] = useState('');
  const [dayShifts, setDayShifts] = useState<DateShift[]>([]);
  const [fromShiftId, setFromShiftId] = useState('');
  const [toShiftId, setToShiftId] = useState('');
  const [ownerBusy, setOwnerBusy] = useState(false);

  useEffect(() => {
    setFromShiftId('');
    setToShiftId('');
    if (!swapDate) {
      setDayShifts([]);
      return;
    }
    void (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<DateShift[]>(`/shifts/on-date/${swapDate}`, auth);
        setDayShifts(res.data ?? []);
      } catch {
        setDayShifts([]);
      }
    })();
  }, [swapDate, getToken]);

  const ownerSwap = useCallback(
    async (override = false) => {
      if (!fromShiftId || !toShiftId) return;
      setOwnerBusy(true);
      setMsg(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post('/shifts/swaps/owner', { fromShiftId, toShiftId, override }, auth);
        setMsg('המשמרות הוחלפו בהצלחה.');
        setFromShiftId('');
        setToShiftId('');
        const res = await api.get<DateShift[]>(`/shifts/on-date/${swapDate}`, auth);
        setDayShifts(res.data ?? []);
      } catch (err) {
        const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
        if (data?.error === 'team_leader_coverage' && data.message) {
          if (window.confirm(data.message)) {
            await ownerSwap(true);
            return;
          }
        } else {
          setMsg(data?.error ? `ההחלפה נכשלה: ${data.error}` : 'ההחלפה נכשלה.');
        }
      } finally {
        setOwnerBusy(false);
      }
    },
    [fromShiftId, toShiftId, swapDate, getToken],
  );

  return (
    <div dir="rtl" className="p-6 max-w-3xl space-y-4">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowRight className="w-4 h-4" />
        חזרה ליומן העבודות
      </Link>

      <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
        <Repeat className="w-6 h-6 text-gray-400" />
        אישור החלפות משמרות
      </h1>

      {msg && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{msg}</p>}

      {loading ? (
        <p className="text-sm text-gray-400">טוען…</p>
      ) : swaps.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">אין בקשות החלפה הממתינות לאישור.</p>
      ) : (
        <div className="space-y-3">
          {swaps.map((s) => (
            <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-900">{s.fromWorkerName}</p>
                  <p className="mt-1 text-xs text-gray-600">{shiftLabel(s.fromShift)}</p>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <p className="text-xs font-semibold text-gray-900">{s.toWorkerName}</p>
                  <p className="mt-1 text-xs text-gray-600">{shiftLabel(s.toShift)}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500">לאחר האישור {s.fromWorkerName} ו{s.toWorkerName} יחליפו משמרות.</p>
              {s.note && <p className="text-xs text-gray-500">הערה: {s.note}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void resolve(s.id, true)}
                  disabled={busyId === s.id}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  אישור ההחלפה
                </button>
                <button
                  type="button"
                  onClick={() => void resolve(s.id, false)}
                  disabled={busyId === s.id}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  דחייה
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">החלפה יזומה (על ידי בעל/ת העסק)</h2>
        <p className="text-xs text-gray-500">בחר/י תאריך ושתי משמרות מאושרות של עובדים שונים כדי להחליף ביניהן ישירות.</p>
        <label className="block text-xs text-gray-600">
          תאריך
          <input
            type="date"
            value={swapDate}
            onChange={(e) => setSwapDate(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        {swapDate && dayShifts.length < 2 && (
          <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">אין מספיק משמרות מאושרות בתאריך זה להחלפה.</p>
        )}
        {dayShifts.length >= 2 && (
          <>
            <label className="block text-xs text-gray-600">
              משמרת ראשונה
              <select
                value={fromShiftId}
                onChange={(e) => setFromShiftId(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">בחר/י משמרת</option>
                {dayShifts.map((s) => (
                  <option key={s.shiftId} value={s.shiftId}>
                    {s.workerName} · {jobTypeLabel(s.jobType)} · {formatTime(s.plannedStart)}–{formatTime(s.plannedEnd)} · {s.customerName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-gray-600">
              משמרת שנייה
              <select
                value={toShiftId}
                onChange={(e) => setToShiftId(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
              >
                <option value="">בחר/י משמרת</option>
                {dayShifts
                  .filter((s) => s.shiftId !== fromShiftId)
                  .map((s) => (
                    <option key={s.shiftId} value={s.shiftId}>
                      {s.workerName} · {jobTypeLabel(s.jobType)} · {formatTime(s.plannedStart)}–{formatTime(s.plannedEnd)} · {s.customerName}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void ownerSwap()}
              disabled={ownerBusy || !fromShiftId || !toShiftId}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              החלפת המשמרות
            </button>
          </>
        )}
      </section>
    </div>
  );
}
