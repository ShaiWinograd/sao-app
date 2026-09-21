'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { api, authHeaders } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { InlineAddressMap } from '../../components/maps/InlineAddressMap';
import {
  jobTypeLabel,
  jobTypeBorderColor,
  jobTypeStripColor,
  formatScheduledTime,
} from '../../lib/worker';

type MyStatus = 'NONE' | 'APPROVED' | 'AWAITING_WORKER' | 'PENDING';

type BoardShift = {
  jobId: string;
  jobType: string;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  customerName: string;
  address: string | null;
  requiredWorkerCount: number;
  assignedWorkers: { name: string; isTeamLeader: boolean; isBackup?: boolean }[];
  openSpots: number;
  myStatus: MyStatus;
  myShiftId: string | null;
  blockedSameDay?: boolean;
};

type SwapShiftView = { date: string; plannedStart: string; plannedEnd: string; jobType: string; customerName: string };
type SwapMine = {
  id: string;
  status: 'PENDING_WORKER' | 'PENDING_OWNER';
  note: string | null;
  direction: 'OUTGOING' | 'INCOMING';
  counterpartName: string;
  myShift: SwapShiftView;
  theirShift: SwapShiftView;
  awaitingMe: boolean;
};

type OpenReplacement = {
  requestId: string;
  reason: string;
  jobType: string;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  address: string | null;
  customerName: string;
  hasVolunteered: boolean;
  volunteerCount: number;
  suggestedForYou: boolean;
};

type AvailabilityBlock = {
  id: string;
  type: 'DATE' | 'RANGE' | 'WEEKLY';
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  reason: string | null;
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function toDateKey(date: Date | string): string {
  const value = new Date(date);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function shiftDateTime(date: string, time: string): number {
  const value = new Date(date);
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (match) value.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return value.getTime();
}

function availabilityForDate(blocks: AvailabilityBlock[], dateKey: string): AvailabilityBlock | null {
  const weekday = new Date(`${dateKey}T12:00:00`).getDay();
  return (
    blocks.find((block) => {
      if (block.type === 'WEEKLY') return block.weekday === weekday;
      const start = block.startDate?.slice(0, 10);
      if (!start) return false;
      if (block.type === 'DATE') return start === dateKey;
      const end = block.endDate?.slice(0, 10);
      return Boolean(end && start <= dateKey && dateKey <= end);
    }) ?? null
  );
}

export default function WorkerShiftsPage() {
  const { getToken } = useAuth();
  const [board, setBoard] = useState<BoardShift[]>([]);
  const [swaps, setSwaps] = useState<SwapMine[]>([]);
  const [replacements, setReplacements] = useState<OpenReplacement[]>([]);
  const [availability, setAvailability] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joinTarget, setJoinTarget] = useState<BoardShift | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const selectedInitialDate = useRef(false);

  const loadBoard = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<BoardShift[]>('/jobs/board', auth);
      setBoard(res.data ?? []);
    } catch {
      setBoard([]);
    }
  }, [getToken]);

  const loadSwaps = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<SwapMine[]>('/shifts/swaps/mine', auth);
      setSwaps(res.data ?? []);
    } catch {
      setSwaps([]);
    }
  }, [getToken]);

  const loadReplacements = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<OpenReplacement[]>('/shifts/replacement-requests/open', auth);
      setReplacements(res.data ?? []);
    } catch {
      setReplacements([]);
    }
  }, [getToken]);

  const loadAvailability = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<AvailabilityBlock[]>('/workers/me/availability', auth);
      setAvailability(res.data ?? []);
    } catch {
      setAvailability([]);
    }
  }, [getToken]);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadBoard(), loadSwaps(), loadReplacements(), loadAvailability()]);
      setLoading(false);
    })();
  }, [loadAvailability, loadBoard, loadSwaps, loadReplacements]);

  useEffect(() => {
    if (selectedInitialDate.current || board.length === 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextShift = [...board]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .find((shift) => new Date(shift.date).getTime() >= today.getTime());
    if (!nextShift) return;

    setSelectedDate(toDateKey(nextShift.date));
    selectedInitialDate.current = true;
  }, [board]);

  const volunteer = useCallback(
    async (requestId: string, has: boolean) => {
      setBusy(requestId);
      setMessage(null);
      try {
        const auth = await authHeaders(getToken);
        if (has) {
          await api.delete(`/shifts/replacement/${requestId}/volunteer`, auth);
        } else {
          await api.post(`/shifts/replacement/${requestId}/volunteer`, {}, auth);
          setMessage('התנדבת למשמרת. בעל/ת העסק תבחר/י מחליף/ה.');
        }
        await loadReplacements();
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setMessage(status === 409 ? 'לא ניתן להתנדב למשמרת זו בתאריך הזה.' : 'הפעולה נכשלה. נסי שוב.');
      } finally {
        setBusy(null);
      }
    },
    [getToken, loadReplacements],
  );

  const askToJoin = useCallback(async () => {
    if (!joinTarget) return;
    setBusy(joinTarget.jobId);
    setMessage(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post('/shifts/join-request', { jobId: joinTarget.jobId }, auth);
      setMessage('בקשת ההצטרפות נשלחה לאישור בעל/ת העסק.');
      setJoinTarget(null);
      await loadBoard();
    } catch (err) {
      const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      setMessage(data?.message ?? (data?.error ? `הבקשה נכשלה: ${data.error}` : 'שליחת הבקשה נכשלה.'));
    } finally {
      setBusy(null);
    }
  }, [joinTarget, getToken, loadBoard]);

  const cancelRequest = useCallback(
    async (shiftId: string) => {
      setBusy(shiftId);
      setMessage(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/${shiftId}/cancel-request`, {}, auth);
        setMessage('בקשת ההצטרפות בוטלה.');
        await loadBoard();
      } catch (err) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setMessage(msg ? `הפעולה נכשלה: ${msg}` : 'ביטול הבקשה נכשל.');
      } finally {
        setBusy(null);
      }
    },
    [getToken, loadBoard],
  );

  const respondAssignment = useCallback(
    async (shiftId: string, accepted: boolean) => {
      setBusy(shiftId);
      setMessage(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/${shiftId}/respond-assignment`, { accepted }, auth);
        setMessage(accepted ? 'אישרת את השיבוץ.' : 'דחית את השיבוץ.');
        await loadBoard();
      } catch (err) {
        const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
        setMessage(data?.message ?? (data?.error ? `הפעולה נכשלה: ${data.error}` : 'הפעולה נכשלה.'));
      } finally {
        setBusy(null);
      }
    },
    [getToken, loadBoard],
  );

  const respondSwap = useCallback(
    async (id: string, approved: boolean) => {
      setBusy(id);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/swaps/${id}/respond`, { approved }, auth);
        await loadSwaps();
      } catch {
        /* keep list; user can retry */
      } finally {
        setBusy(null);
      }
    },
    [getToken, loadSwaps],
  );

  const cancelSwap = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        const auth = await authHeaders(getToken);
        await api.delete(`/shifts/swaps/${id}`, auth);
        await loadSwaps();
      } catch {
        /* keep list; user can retry */
      } finally {
        setBusy(null);
      }
    },
    [getToken, loadSwaps],
  );

  const myShifts = useMemo(() => board.filter((s) => s.myStatus !== 'NONE'), [board]);
  const nextMyShift = useMemo(() => {
    const now = new Date();
    return [...myShifts]
      .filter((shift) => shift.myStatus === 'APPROVED' && shiftDateTime(shift.date, shift.plannedEnd) >= now.getTime())
      .sort((a, b) => {
        const aTime = shiftDateTime(a.date, a.plannedStart);
        const bTime = shiftDateTime(b.date, b.plannedStart);
        return aTime - bTime;
      })[0] ?? null;
  }, [myShifts]);
  const visible = board;
  const calendarDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const minimumEnd = new Date(start);
    minimumEnd.setDate(start.getDate() + 20);
    const lastShift = visible.reduce<Date | null>((latest, shift) => {
      const date = new Date(shift.date);
      date.setHours(0, 0, 0, 0);
      return !latest || date > latest ? date : latest;
    }, null);
    const end = lastShift && lastShift > minimumEnd ? lastShift : minimumEnd;
    const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    return Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [visible]);
  const shiftsByDate = useMemo(
    () =>
      visible.reduce((groups, shift) => {
        const key = toDateKey(shift.date);
        groups.set(key, [...(groups.get(key) ?? []), shift]);
        return groups;
      }, new Map<string, BoardShift[]>()),
    [visible],
  );

  const selectDate = useCallback((dateKey: string) => {
    setSelectedDate(dateKey);
    window.setTimeout(() => {
      document.getElementById(`worker-day-${dateKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, []);

  const markUnavailable = useCallback(async (dateKey: string) => {
    setBusy(`availability-${dateKey}`);
    setMessage(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post('/workers/me/availability', { type: 'DATE', startDate: dateKey }, auth);
      await loadAvailability();
      setMessage(`סומן שאינך זמינה ב-${new Date(`${dateKey}T00:00:00`).toLocaleDateString('he-IL')}.`);
    } catch {
      setMessage('לא ניתן לסמן את היום כלא זמין. ייתכן שכבר יש לך שיבוץ ביום הזה.');
    } finally {
      setBusy(null);
    }
  }, [getToken, loadAvailability]);

  const removeUnavailable = useCallback(async (blockId: string, dateKey: string) => {
    setBusy(`availability-${dateKey}`);
    setMessage(null);
    try {
      const auth = await authHeaders(getToken);
      await api.delete(`/workers/me/availability/${blockId}`, auth);
      await loadAvailability();
      setMessage(`הזמינות ל-${new Date(`${dateKey}T00:00:00`).toLocaleDateString('he-IL')} עודכנה.`);
    } catch {
      setMessage('לא ניתן לעדכן את הזמינות. נסי שוב.');
    } finally {
      setBusy(null);
    }
  }, [getToken, loadAvailability]);

  const downloadCalendar = useCallback(() => {
    const events = myShifts
      .filter((shift) => shift.myStatus === 'APPROVED')
      .map((shift) => {
        const start = `${toDateKey(shift.date).replaceAll('-', '')}T${formatScheduledTime(shift.plannedStart).replace(':', '')}00`;
        const end = `${toDateKey(shift.date).replaceAll('-', '')}T${formatScheduledTime(shift.plannedEnd).replace(':', '')}00`;
        return [
          'BEGIN:VEVENT',
          `UID:${shift.jobId}@space-and-order`,
          `DTSTART;TZID=Asia/Jerusalem:${start}`,
          `DTEND;TZID=Asia/Jerusalem:${end}`,
          `SUMMARY:${jobTypeLabel(shift.jobType)} - ${shift.customerName}`,
          `LOCATION:${shift.address ?? ''}`,
          'END:VEVENT',
        ].join('\r\n');
      });
    const calendar = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Space and Order//Worker Calendar//HE', ...events, 'END:VCALENDAR'].join('\r\n');
    const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'space-and-order-shifts.ics';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [myShifts]);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="mx-auto w-full max-w-[1120px] space-y-6">
      <PageHeader
        eyebrow="YOUR WORK, BEAUTIFULLY ARRANGED"
        title="המשמרות שלי"
        description="כל מה שצריך לדעת ולעשות לקראת העבודה הבאה."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--color-border-strong)] py-3">
        <div>
          <p className="text-sm font-semibold text-[#292724]">היומן של כולן</p>
          <p className="text-xs text-[var(--color-text-secondary)]">שיבוצים, הזמנות שמחכות לאישורך ומשמרות פתוחות במקום אחד.</p>
        </div>
        <button type="button" onClick={downloadCalendar} className="border border-primary-700 px-3 py-2 text-xs font-semibold text-primary-800">
          הוספה ל-Google או Apple Calendar
        </button>
      </div>

      {nextMyShift && (
        <section className="grid gap-4 border-t-2 border-primary-700 bg-primary-100/70 p-4 sm:grid-cols-[minmax(0,1fr)_6rem] sm:p-5">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.12em] text-primary-700">המשמרת הבאה</p>
            <h2 className="font-display mt-1 text-2xl font-medium leading-tight text-[#292724]">
              {jobTypeLabel(nextMyShift.jobType)}
            </h2>
            <p className="mt-1 text-sm font-semibold text-[#292724]">{nextMyShift.customerName}</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              <bdi>{formatScheduledTime(nextMyShift.plannedStart)}–{formatScheduledTime(nextMyShift.plannedEnd)}</bdi>
            </p>
            {nextMyShift.address && <InlineAddressMap address={nextMyShift.address} compact />}
            <div className="mt-3 border-t border-primary-200 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-text-muted)]">הצוות במשמרת</p>
              <div className="mt-1"><AssignedNames workers={nextMyShift.assignedWorkers} /></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[#53644b]">● השיבוץ שלך מאושר</span>
              {nextMyShift.myShiftId && (
                <Link
                  href={`/worker/shifts/${nextMyShift.myShiftId}`}
                  className="border border-primary-700 px-4 py-2 text-xs font-semibold text-primary-800 transition-colors hover:bg-primary-700 hover:text-white"
                >
                  כל פרטי המשמרת ←
                </Link>
              )}
            </div>
          </div>
          <div className="hidden border-r border-[var(--color-border-strong)] pr-4 text-center sm:block">
            <span className="font-display block text-4xl leading-none text-primary-700">
              {new Date(nextMyShift.date).getDate()}
            </span>
            <span className="mt-2 block text-xs text-[var(--color-text-secondary)]">
              {new Date(nextMyShift.date).toLocaleDateString('he-IL', { month: 'long', weekday: 'long' })}
            </span>
          </div>
        </section>
      )}

      <section
        className="pb-4"
        data-swipe-navigation="ignore"
      >
        <div className="mx-auto mb-3 flex max-w-[900px] flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[#292724]">השבוע שלך</p>
            <button
              type="button"
              onClick={() => selectDate(toDateKey(new Date()))}
              className="mt-1 text-[11px] font-semibold text-primary-700 underline decoration-primary-300 underline-offset-4"
            >
              חזרה להיום
            </button>
          </div>
        </div>
        <div
          className="mx-auto flex max-w-[900px] gap-1 overflow-x-auto border-y border-[var(--color-border)] py-3"
          data-testid="worker-week-calendar"
        >
          {calendarDays.map((date) => {
            const key = toDateKey(date);
            const active = key === selectedDate;
            const hasShift = visible.some((shift) => toDateKey(shift.date) === key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectDate(key)}
                className={`flex min-h-[76px] min-w-16 flex-col items-center justify-center px-1 transition-colors ${
                  active ? 'bg-primary-700 text-white' : 'text-[var(--color-text-secondary)] hover:bg-primary-50'
                }`}
              >
                <span className={`text-[11px] ${active ? 'text-white/75' : 'text-gray-400'}`}>
                  {date.toLocaleDateString('he-IL', { weekday: 'long' })}
                </span>
                <span className="font-display mt-1 text-2xl font-semibold leading-none">{date.getDate()}</span>
                <span className={`mt-1 h-1 w-1 rounded-full ${hasShift ? (active ? 'bg-white' : 'bg-primary-500') : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>
      </section>

      {message && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800">{message}</div>
      )}

      {swaps.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">בקשות החלפת משמרות</h2>
          {swaps.map((s) => (
            <div key={s.id} className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs">
              <p className="font-semibold text-gray-900">
                {s.direction === 'INCOMING' ? `${s.counterpartName} מציע/ה החלפה` : `הצעת החלפה ל${s.counterpartName}`}
                {' · '}
                <span className={s.status === 'PENDING_WORKER' ? 'text-amber-700' : 'text-blue-700'}>
                  {s.status === 'PENDING_WORKER' ? 'ממתין לאישור העובד/ת' : 'ממתין לבעל/ת העסק'}
                </span>
              </p>
              <p className="text-gray-600">
                המשמרת שלך: {shortDate(s.myShift.date)} {formatScheduledTime(s.myShift.plannedStart)}–{formatScheduledTime(s.myShift.plannedEnd)} · שלה/ו: {shortDate(s.theirShift.date)} {formatScheduledTime(s.theirShift.plannedStart)}–{formatScheduledTime(s.theirShift.plannedEnd)}
              </p>
              {s.awaitingMe ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => void respondSwap(s.id, true)} disabled={busy === s.id} className="rounded-lg bg-primary-600 px-3 py-1 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">אישור</button>
                  <button type="button" onClick={() => void respondSwap(s.id, false)} disabled={busy === s.id} className="rounded-lg border border-gray-300 px-3 py-1 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">דחייה</button>
                </div>
              ) : s.direction === 'OUTGOING' ? (
                <button type="button" onClick={() => void cancelSwap(s.id)} disabled={busy === s.id} className="rounded-lg border border-gray-300 px-3 py-1 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">ביטול ההצעה</button>
              ) : null}
            </div>
          ))}
        </section>
      )}

      <div className="space-y-2">
        {calendarDays.map((date) => {
          const dateKey = toDateKey(date);
          const shifts = shiftsByDate.get(dateKey) ?? [];
          const availabilityBlock = availabilityForDate(availability, dateKey);
          return (
              <section
                key={dateKey}
                id={`worker-day-${dateKey}`}
                className={`scroll-mt-24 border-b border-[var(--color-border)] pb-4 ${
                  selectedDate === dateKey ? 'bg-primary-50/35' : ''
                }`}
              >
                <div className="sticky top-0 z-10 border-b border-[var(--color-border-strong)] bg-[var(--color-background)] py-2">
                  <h2 className="font-display text-xl text-[#292724]">{new Date(`${dateKey}T00:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
                </div>
                {shifts.length === 0 ? (
                  <div className="flex min-h-24 flex-wrap items-center justify-between gap-3 px-1 py-4">
                    <div>
                      <p className="text-sm font-medium text-gray-700">אין משמרת ביום הזה</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {availabilityBlock ? 'היום מסומן כלא זמין.' : 'אפשר לסמן כאן אי-זמינות.'}
                      </p>
                    </div>
                    {availabilityBlock?.type === 'DATE' ? (
                      <button
                        type="button"
                        onClick={() => void removeUnavailable(availabilityBlock.id, dateKey)}
                        disabled={busy === `availability-${dateKey}`}
                        className="border border-[var(--color-calendar-sage)] px-3 py-2 text-xs font-semibold text-[var(--color-calendar-sage)] disabled:opacity-50"
                      >
                        סימון כזמינה
                      </button>
                    ) : availabilityBlock ? (
                      <Link href="/worker/availability" className="border border-[var(--color-border-strong)] px-3 py-2 text-xs font-semibold text-gray-700">
                        שינוי זמינות
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void markUnavailable(dateKey)}
                        disabled={busy === `availability-${dateKey}`}
                        className="border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 disabled:opacity-50"
                      >
                        לא זמינה ביום הזה
                      </button>
                    )}
                  </div>
                ) : shifts.map((s) => (
                <div key={s.jobId} className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-start gap-4 border-b border-[var(--color-border)] py-4 sm:grid-cols-[5rem_minmax(0,1fr)]">
                  <div className="border-l border-[var(--color-border)] pl-3 text-center" dir="ltr">
                    <p className="font-display text-2xl leading-none text-[#292724]">{formatScheduledTime(s.plannedStart)}</p>
                    <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{formatScheduledTime(s.plannedEnd)}</p>
                  </div>
                  <ShiftCard
                    shift={s}
                    busy={busy === s.jobId || (s.myShiftId ? busy === s.myShiftId : false)}
                    onAskToJoin={() => setJoinTarget(s)}
                    onRespond={(accepted) => s.myShiftId && void respondAssignment(s.myShiftId, accepted)}
                    onCancelRequest={() => s.myShiftId && void cancelRequest(s.myShiftId)}
                  />
                </div>
                ))}
              </section>
          );
        })}
      </div>

      {replacements.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">משמרות הדורשות החלפה</h2>
          {replacements.map((r) => (
            <div key={r.requestId} className="relative overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 pr-5">
              <span className={`absolute inset-y-0 right-0 w-1.5 ${jobTypeStripColor(r.jobType)}`} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-gray-900">{jobTypeLabel(r.jobType)}</span>
                <span className="text-xs font-medium text-gray-600">{shortDate(r.date)}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-gray-900">{r.customerName}</p>
              <p className="mt-0.5 text-xs text-gray-600">{formatScheduledTime(r.plannedStart)}–{formatScheduledTime(r.plannedEnd)}</p>
              {r.suggestedForYou && (
                <span className="mt-1.5 inline-flex border-b border-primary-300 pb-0.5 text-[11px] font-medium text-primary-700">הוצעת להחלפה זו</span>
              )}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => void volunteer(r.requestId, r.hasVolunteered)}
                  disabled={busy === r.requestId}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    r.hasVolunteered
                      ? 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                      : 'bg-primary-600 text-white hover:bg-primary-700'
                  }`}
                >
                  {r.hasVolunteered ? 'ביטול התנדבות' : 'התנדבות להחלפה'}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {joinTarget && (
        <JoinModal
          shift={joinTarget}
          busy={busy === joinTarget.jobId}
          onConfirm={() => void askToJoin()}
          onClose={() => setJoinTarget(null)}
        />
      )}
    </div>
  );
}

function AssignedNames({ workers }: { workers: BoardShift['assignedWorkers'] }) {
  if (workers.length === 0) return <span className="text-gray-400">טרם שובצו עובדים</span>;
  return (
    <span className="text-[11px] text-gray-600">
      {workers.map((worker) => `${worker.name}${worker.isTeamLeader ? ' · ראש צוות' : ''}`).join('  |  ')}
    </span>
  );
}

function CardHeader({ shift }: { shift: BoardShift }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-bold text-gray-900">{jobTypeLabel(shift.jobType)}</span>
      <span className="text-xs font-medium text-gray-600">{shortDate(shift.date)}</span>
    </div>
  );
}

function CardMeta({ shift }: { shift: BoardShift }) {
  return (
    <>
      <p className="mt-1 text-sm font-semibold text-gray-900">{shift.customerName}</p>
      <p className="mt-0.5 text-xs text-gray-600">{formatScheduledTime(shift.plannedStart)}–{formatScheduledTime(shift.plannedEnd)}</p>
      {shift.address && (
        <p className="mt-0.5 text-xs text-gray-600">{shift.address}</p>
      )}
    </>
  );
}

function ShiftCard({
  shift,
  busy,
  onAskToJoin,
  onRespond,
  onCancelRequest,
}: {
  shift: BoardShift;
  busy: boolean;
  onAskToJoin: () => void;
  onRespond: (accepted: boolean) => void;
  onCancelRequest: () => void;
}) {
  // 1) Fully assigned (not mine).
  if (shift.myStatus === 'NONE' && shift.openSpots === 0) {
    return (
      <div className="relative px-1">
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
        <div className="mt-2">
          <AssignedNames workers={shift.assignedWorkers} />
        </div>
        <p className="mt-3 inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">העבודה מלאה</p>
      </div>
    );
  }

  // 2) Open spots (not mine): if already booked that date, show as unavailable
  //    (spec §8.1); otherwise click to ask to join.
  if (shift.myStatus === 'NONE' && shift.openSpots > 0) {
    if (shift.blockedSameDay) {
      return (
        <div className="relative w-full px-1 text-right opacity-70">
          <CardHeader shift={shift} />
          <CardMeta shift={shift} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium text-gray-500">
              {shift.openSpots} מקומות פנויים
            </span>
            <AssignedNames workers={shift.assignedWorkers} />
          </div>
          <p className="mt-2 text-[11px] font-semibold text-gray-500">כבר יש לך בקשה או שיבוץ בתאריך זה</p>
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={onAskToJoin}
        className="relative w-full px-1 text-right transition-colors hover:text-primary-800"
      >
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">
            {shift.openSpots} מקומות פנויים
          </span>
          <AssignedNames workers={shift.assignedWorkers} />
        </div>
        <p className="mt-2 text-[11px] font-semibold text-primary-700">לחצי כדי לבקש להצטרף ›</p>
      </button>
    );
  }

  // 3) Assigned by the owner, awaiting my acceptance: white card + full type border + actions.
  if (shift.myStatus === 'AWAITING_WORKER') {
    return (
      <div className={`border-r-2 pr-4 ${jobTypeBorderColor(shift.jobType)}`}>
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
        <div className="mt-2">
          <AssignedNames workers={shift.assignedWorkers} />
        </div>
        <p className="mt-2 text-xs font-medium text-amber-800">שובצת למשמרת זו – יש לאשר או לדחות.</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onRespond(true)}
            disabled={busy}
            className="inline-flex items-center rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            אישור
          </button>
          <button
            type="button"
            onClick={() => onRespond(false)}
            disabled={busy}
            className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            דחייה
          </button>
        </div>
      </div>
    );
  }

  // 4) My confirmed shift: tinted card + full type border + swap/drop.
  if (shift.myStatus === 'APPROVED') {
    return (
      <div className={`border-r-2 pr-4 ${jobTypeBorderColor(shift.jobType)}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-gray-900">{jobTypeLabel(shift.jobType)}</span>
          <span className="inline-flex items-center rounded-full border border-primary-300 bg-primary-100 px-2 py-0.5 text-[11px] font-semibold text-primary-800">
            את/ה משובץ/ת
          </span>
        </div>
        <CardMeta shift={shift} />
        <div className="mt-2">
          <AssignedNames workers={shift.assignedWorkers} />
        </div>
        <div className="mt-2 flex gap-2">
          <Link
            href={`/worker/shifts/${shift.myShiftId}`}
            className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            החלפה או בקשת מחליפה
          </Link>
        </div>
      </div>
    );
  }

  // 5) My pending join request.
  return (
    <div className="relative block border-r-2 border-amber-300 pr-4">
      <Link href={shift.myShiftId ? `/worker/shifts/${shift.myShiftId}` : '#'} className="block hover:opacity-90">
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
        <div className="mt-2">
          <AssignedNames workers={shift.assignedWorkers} />
        </div>
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          ממתין לאישור בעל/ת העסק
        </span>
        <button
          type="button"
          onClick={onCancelRequest}
          disabled={busy}
          className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          ביטול בקשה
        </button>
      </div>
    </div>
  );
}

function JoinModal({
  shift,
  busy,
  onConfirm,
  onClose,
}: {
  shift: BoardShift;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-xl bg-[var(--color-surface)] p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900">בקשה להצטרף למשמרת</h2>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          <p className="font-semibold text-gray-900">{jobTypeLabel(shift.jobType)} · {shift.customerName}</p>
          <p className="mt-0.5 text-xs text-gray-600">
            {shortDate(shift.date)} · {formatScheduledTime(shift.plannedStart)}–{formatScheduledTime(shift.plannedEnd)}
          </p>
        </div>
        <p className="text-xs text-gray-500">הבקשה תישלח לאישור בעל/ת העסק. תקבלי הודעה כשהיא תאושר.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            שליחת בקשה
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
