'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CalendarOff, Trash2, Plus } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';

type BlockType = 'DATE' | 'RANGE' | 'WEEKLY';
type Block = {
  id: string;
  type: BlockType;
  startDate?: string | null;
  endDate?: string | null;
  weekday?: number | null;
  reason?: string | null;
};

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const REASONS = ['בחופש', 'בחו״ל', 'לא זמינה'];

function fmt(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

function describe(b: Block): string {
  if (b.type === 'WEEKLY') return `כל יום ${WEEKDAYS[b.weekday ?? 0]}`;
  if (b.type === 'RANGE') return `${fmt(b.startDate)} – ${fmt(b.endDate)}`;
  return fmt(b.startDate);
}

export default function WorkerAvailabilityPage() {
  const { getToken } = useAuth();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [type, setType] = useState<BlockType>('DATE');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [weekday, setWeekday] = useState(0);
  const [reason, setReason] = useState('');

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
    if (type !== 'WEEKLY' && !startDate) {
      setMessage('יש לבחור תאריך.');
      return;
    }
    if (type === 'RANGE' && (!endDate || endDate < startDate)) {
      setMessage('יש לבחור טווח תאריכים תקין.');
      return;
    }
    setBusy(true);
    try {
      const auth = await authHeaders(getToken);
      await api.post(
        '/workers/me/availability',
        {
          type,
          startDate: type !== 'WEEKLY' ? startDate : undefined,
          endDate: type === 'RANGE' ? endDate : undefined,
          weekday: type === 'WEEKLY' ? weekday : undefined,
          reason: reason.trim() || undefined,
        },
        auth,
      );
      setStartDate('');
      setEndDate('');
      setReason('');
      await load();
    } catch {
      setMessage('לא ניתן היה לשמור. נסי שוב.');
    } finally {
      setBusy(false);
    }
  }, [type, startDate, endDate, weekday, reason, getToken, load]);

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
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">הזמינות שלי</h1>
        <p className="text-sm text-gray-500 mt-0.5">סמני תאריכים או ימים קבועים שבהם אינך זמינה לעבודה.</p>
      </div>

      {error ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">לא נמצא פרופיל עובד/ת לחשבון זה.</p>
      ) : (
        <>
          {/* Add block */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">הוספת חסימה</h2>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-xs">
              {([['DATE', 'תאריך בודד'], ['RANGE', 'טווח תאריכים'], ['WEEKLY', 'יום קבוע בשבוע']] as [BlockType, string][]).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setType(v)}
                  className={`rounded-md px-3 py-1 font-medium ${type === v ? 'bg-primary-600 text-white' : 'text-gray-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              {type === 'WEEKLY' ? (
                <label className="text-xs text-gray-600">
                  יום בשבוע
                  <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white">
                    {WEEKDAYS.map((w, i) => (
                      <option key={i} value={i}>{w}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="text-xs text-gray-600">
                  {type === 'RANGE' ? 'מתאריך' : 'תאריך'}
                  <input type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                </label>
              )}
              {type === 'RANGE' && (
                <label className="text-xs text-gray-600">
                  עד תאריך
                  <input type="date" min={startDate || today} value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 block rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                </label>
              )}
              <label className="text-xs text-gray-600 flex-1 min-w-[140px]">
                סיבה (רשות)
                <input list="reasons" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                <datalist id="reasons">
                  {REASONS.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </label>
              <button
                type="button"
                onClick={() => void add()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                הוספה
              </button>
            </div>
            {message && <p className="text-xs text-rose-600">{message}</p>}
          </div>

          {/* Existing blocks */}
          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-2">חסימות פעילות</h2>
            {blocks.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
                <CalendarOff className="mx-auto w-6 h-6 text-gray-300" />
                <p className="mt-1.5 text-sm text-gray-500">לא הוגדרו חסימות. את זמינה לכל העבודות.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {blocks.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
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
    </div>
  );
}
