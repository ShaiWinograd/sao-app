'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { israeliNonWorkingDayName } from '@workforce/shared';
import { api, authHeaders } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { InlineAddressMap } from '../../components/maps/InlineAddressMap';
import {
  jobTypeLabel,
  jobTypeBorderColor,
  jobTypeClasses,
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
  replacementStatus?: string;
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
  startTime: string | null;
  endTime: string | null;
};

type AvailabilityConflict = {
  shiftId: string;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  jobType: string;
  customerName: string;
  replacementStatus?: string;
};

const AVAILABILITY_REASONS = ['חופש', 'חו״ל', 'חולה', 'אחר'] as const;

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
  const exact = blocks.find((block) => block.type === 'DATE' && block.startDate?.slice(0, 10) === dateKey);
  if (exact) return exact;
  return (
    blocks.find((block) => {
      if (block.type === 'WEEKLY') return block.weekday === weekday;
      const start = block.startDate?.slice(0, 10);
      if (!start) return false;
      const end = block.endDate?.slice(0, 10);
      return Boolean(end && start <= dateKey && dateKey <= end);
    }) ?? null
  );
}

export default function WorkerShiftsPage() {
  const { getToken } = useAuth();
  const searchParams = useSearchParams();
  const [board, setBoard] = useState<BoardShift[]>([]);
  const [swaps, setSwaps] = useState<SwapMine[]>([]);
  const [replacements, setReplacements] = useState<OpenReplacement[]>([]);
  const [availability, setAvailability] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joinTarget, setJoinTarget] = useState<BoardShift | null>(null);
  const [replacementTarget, setReplacementTarget] = useState<BoardShift | null>(null);
  const [colleagues, setColleagues] = useState<{ id: string; name: string }[]>([]);
  const [availabilityTarget, setAvailabilityTarget] = useState<string | null>(null);
  const [availabilityConflicts, setAvailabilityConflicts] = useState<AvailabilityConflict[]>([]);
  const [focusedShiftId, setFocusedShiftId] = useState<string | null>(null);
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'MINE'>('ALL');
  const [nextShiftExpanded, setNextShiftExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const initialCalendarPositioned = useRef(false);
  const queryReplacementOpened = useRef(false);
  const queryFocusOpened = useRef(false);

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
          setMessage('התנדבת למשמרת. תקבלי עדכון לאחר הבחירה.');
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
      setMessage('בקשת ההצטרפות נשלחה לאישור.');
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

  const openReplacement = useCallback(async (shift: BoardShift) => {
    setMessage(null);
    setReplacementTarget(shift);
    setColleagues([]);
    if (shift.replacementStatus === 'PENDING' || !shift.myShiftId) return;
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<{ id: string; name: string }[]>(
        `/workers/replacement-candidates?shiftId=${encodeURIComponent(shift.myShiftId)}`,
        auth,
      );
      setColleagues(res.data ?? []);
    } catch {
      setColleagues([]);
    }
  }, [getToken]);

  const requestReplacement = useCallback(async (reason: string, suggestedWorkerIds: string[]) => {
    if (!replacementTarget?.myShiftId) return;
    setBusy(replacementTarget.myShiftId);
    setMessage(null);
    try {
      const auth = await authHeaders(getToken);
      const response = await api.post<{ released?: boolean }>(
        `/shifts/${replacementTarget.myShiftId}/replacement`,
        { reason, suggestedWorkerIds },
        auth,
      );
      setMessage(
        response.data.released
          ? 'המשמרת הועברה לגיבוי הזמין.'
          : 'בקשת המחליפה נשלחה. את נשארת משובצת עד לאישור.',
      );
      setReplacementTarget(null);
      await loadBoard();
    } catch (err) {
      const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      setMessage(data?.message ?? (data?.error ? `שליחת הבקשה נכשלה: ${data.error}` : 'שליחת הבקשה נכשלה. נסי שוב.'));
    } finally {
      setBusy(null);
    }
  }, [getToken, loadBoard, replacementTarget]);

  const cancelReplacement = useCallback(async () => {
    if (!replacementTarget?.myShiftId) return;
    setBusy(replacementTarget.myShiftId);
    setMessage(null);
    try {
      const auth = await authHeaders(getToken);
      await api.delete(`/shifts/${replacementTarget.myShiftId}/replacement`, auth);
      setMessage('בקשת המחליפה בוטלה.');
      setReplacementTarget(null);
      await loadBoard();
    } catch {
      setMessage('ביטול בקשת המחליפה נכשל.');
    } finally {
      setBusy(null);
    }
  }, [getToken, loadBoard, replacementTarget]);

  useEffect(() => {
    const shiftId = searchParams.get('replacementShiftId');
    if (loading || queryReplacementOpened.current || !shiftId) return;
    queryReplacementOpened.current = true;
    const shift = board.find((candidate) => candidate.myShiftId === shiftId);
    if (shift) void openReplacement(shift);
  }, [board, loading, openReplacement, searchParams]);

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
  const visible = useMemo(
    () => shiftFilter === 'MINE' ? board.filter((shift) => shift.myStatus !== 'NONE') : board,
    [board, shiftFilter],
  );
  const calendarDays = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 2);
    const days: Date[] = [];
    for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      days.push(new Date(date));
    }
    return days;
  }, []);
  const shiftsByDate = useMemo(
    () =>
      visible.reduce((groups, shift) => {
        const key = toDateKey(shift.date);
        groups.set(key, [...(groups.get(key) ?? []), shift]);
        return groups;
      }, new Map<string, BoardShift[]>()),
    [visible],
  );

  useEffect(() => {
    if (loading || initialCalendarPositioned.current) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`worker-day-${selectedDate}`)?.scrollIntoView({
        block: 'start',
      });
      document.querySelector<HTMLElement>(`[data-worker-date="${selectedDate}"]`)?.scrollIntoView({
        block: 'nearest',
        inline: 'center',
      });
      initialCalendarPositioned.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [board.length, loading, selectedDate]);

  useEffect(() => {
    const scrollContainer = document.querySelector<HTMLElement>('.app-main');
    if (!scrollContainer) return;
    let frame = 0;
    const updateSelectedDate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-worker-day]'));
        if (sections.length === 0) return;
        const stickyOffset = scrollContainer.getBoundingClientRect().top + 220;
        let visibleDate = sections[0].dataset.workerDay;
        for (const section of sections) {
          if (section.getBoundingClientRect().top <= stickyOffset) {
            visibleDate = section.dataset.workerDay;
          } else {
            break;
          }
        }
        if (visibleDate) setSelectedDate((current) => current === visibleDate ? current : visibleDate);
      });
    };
    scrollContainer.addEventListener('scroll', updateSelectedDate, { passive: true });
    updateSelectedDate();
    return () => {
      scrollContainer.removeEventListener('scroll', updateSelectedDate);
      window.cancelAnimationFrame(frame);
    };
  }, [calendarDays]);

  useEffect(() => {
    document.querySelector<HTMLElement>(`[data-worker-date="${selectedDate}"]`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [selectedDate]);

  const selectDate = useCallback((dateKey: string) => {
    setSelectedDate(dateKey);
    window.setTimeout(() => {
      document.getElementById(`worker-day-${dateKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }, []);

  useEffect(() => {
    const shiftId = searchParams.get('focusShiftId');
    const jobId = searchParams.get('focusJobId');
    if (loading || queryFocusOpened.current || (!shiftId && !jobId)) return;
    const shift = board.find((candidate) =>
      shiftId ? candidate.myShiftId === shiftId : candidate.jobId === jobId,
    );
    if (!shift) return;
    queryFocusOpened.current = true;
    setFocusedShiftId(shift.myShiftId);
    selectDate(toDateKey(shift.date));
    window.setTimeout(() => {
      if (shift.myShiftId) {
        document.querySelector<HTMLElement>(`[data-worker-shift="${shift.myShiftId}"]`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }, 350);
  }, [board, loading, searchParams, selectDate]);

  const saveAvailability = useCallback(async (
    values: {
      type: 'DATE' | 'RANGE';
      startDate: string;
      endDate?: string;
      reason: string;
      startTime?: string;
      endTime?: string;
    },
    existing?: AvailabilityBlock | null,
  ) => {
    setBusy(`availability-${availabilityTarget}`);
    setMessage(null);
    setAvailabilityConflicts([]);
    try {
      const auth = await authHeaders(getToken);
      if (existing) {
        await api.patch(`/workers/me/availability/${existing.id}`, values, auth);
      } else {
        await api.post('/workers/me/availability', values, auth);
      }
      await loadAvailability();
      setAvailabilityTarget(null);
      setMessage('הזמינות נשמרה.');
    } catch (err) {
      const data = (err as {
        response?: {
          data?: {
            error?: string;
            message?: string;
            conflicts?: AvailabilityConflict[];
          };
        };
      })?.response?.data;
      if (data?.error === 'AVAILABILITY_CONFLICT' && data.conflicts?.length) {
        setAvailabilityConflicts(data.conflicts);
      } else {
        setMessage(data?.message ?? 'לא ניתן לשמור את הזמינות.');
      }
    } finally {
      setBusy(null);
    }
  }, [availabilityTarget, getToken, loadAvailability]);

  const removeUnavailable = useCallback(async (blockId: string, dateKey: string) => {
    setBusy(`availability-${dateKey}`);
    setMessage(null);
    try {
      const auth = await authHeaders(getToken);
      await api.delete(`/workers/me/availability/${blockId}`, auth);
      await loadAvailability();
      setAvailabilityTarget(null);
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
        title="יומן"
        action={(
          <button
            type="button"
            onClick={downloadCalendar}
            aria-label="הוספה ל-Google או Apple Calendar"
            className="text-xs font-semibold text-primary-700 underline decoration-primary-300 underline-offset-4 hover:text-primary-900"
          >
            ייצוא ליומן
          </button>
        )}
      />

      {nextMyShift && (
        <section>
          <button
            type="button"
            aria-expanded={nextShiftExpanded}
            onClick={() => setNextShiftExpanded((value) => !value)}
            className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 border px-4 py-2.5 text-right text-sm font-semibold transition-opacity hover:opacity-85 ${jobTypeClasses(nextMyShift.jobType)}`}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <span className="opacity-70">העבודה הבאה</span>
              <span className="truncate">{nextMyShift.customerName}</span>
              <span className="opacity-80">
                {shortDate(nextMyShift.date)} · <bdi>{formatScheduledTime(nextMyShift.plannedStart)}–{formatScheduledTime(nextMyShift.plannedEnd)}</bdi>
              </span>
            </div>
          </button>
          {nextShiftExpanded && (
            <div className="border-x border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3">
              <NextShiftDetails shift={nextMyShift} onReplacement={() => void openReplacement(nextMyShift)} />
            </div>
          )}
        </section>
      )}

      <section
        className="sticky top-0 z-30 -mx-3 bg-[var(--color-background)] px-3 pb-3 pt-2 sm:-mx-6 sm:px-6"
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
          <div className="inline-flex border border-[var(--color-border-strong)] p-0.5 text-xs" aria-label="סינון משמרות">
            <button
              type="button"
              onClick={() => setShiftFilter('ALL')}
              className={`px-3 py-1.5 font-semibold ${shiftFilter === 'ALL' ? 'bg-primary-700 text-white' : 'text-gray-600'}`}
            >
              כל המשמרות
            </button>
            <button
              type="button"
              onClick={() => setShiftFilter('MINE')}
              className={`px-3 py-1.5 font-semibold ${shiftFilter === 'MINE' ? 'bg-primary-700 text-white' : 'text-gray-600'}`}
            >
              קשורות אליי
            </button>
          </div>
        </div>
        <div
          className="mx-auto flex max-w-[900px] gap-1 overflow-x-auto py-2"
          data-testid="worker-week-calendar"
        >
          {calendarDays.map((date) => {
            const key = toDateKey(date);
            const active = key === selectedDate;
            const hasShift = visible.some((shift) => toDateKey(shift.date) === key);
            const hasAvailability = Boolean(availabilityForDate(availability, key));
            const nonWorkingDay = israeliNonWorkingDayName(date);
            return (
              <button
                key={key}
                type="button"
                data-worker-date={key}
                data-non-working={nonWorkingDay ? 'true' : undefined}
                onClick={() => selectDate(key)}
                className={`flex min-h-[76px] min-w-16 flex-col items-center justify-center px-1 transition-colors ${
                  nonWorkingDay
                    ? active
                      ? 'bg-gray-300 text-gray-600'
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                    : active
                    ? 'bg-primary-700 text-white'
                    : 'text-[var(--color-text-secondary)] hover:bg-primary-50'
                }`}
              >
                <span className={`text-[11px] ${active && !nonWorkingDay ? 'text-white/75' : 'text-gray-400'}`}>
                  {date.toLocaleDateString('he-IL', { weekday: 'long' })}
                </span>
                <span className="relative mt-1 inline-flex pb-3">
                  <span data-worker-day-number className="font-display text-2xl font-semibold leading-none">{date.getDate()}</span>
                  <span data-worker-indicators className="absolute bottom-0 left-1/2 flex h-1.5 -translate-x-1/2 items-center gap-1">
                    {hasShift && (
                      <span
                        data-worker-indicator="shift"
                        className={`h-1.5 w-1.5 rounded-full ${active && !nonWorkingDay ? 'bg-white' : 'bg-primary-500'}`}
                      />
                    )}
                    {hasAvailability && (
                      <span
                        aria-label="הוגדרה זמינות"
                        data-worker-indicator="availability"
                        className={`h-1.5 w-1.5 rounded-full ${active && !nonWorkingDay ? 'bg-white/70' : 'bg-[#8b7d84]'}`}
                      />
                    )}
                  </span>
                </span>
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
                  {s.status === 'PENDING_WORKER' ? 'ממתין לאישור העובד/ת' : 'ממתין לאישור'}
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
          const nonWorkingDay = israeliNonWorkingDayName(date);
          return (
              <section
                key={dateKey}
                id={`worker-day-${dateKey}`}
                data-worker-day={dateKey}
                data-non-working={nonWorkingDay ? 'true' : undefined}
                className={`scroll-mt-44 border-b border-[var(--color-border)] ${
                  nonWorkingDay
                    ? 'bg-gray-100/70'
                    : selectedDate === dateKey
                      ? 'bg-primary-50/35'
                      : ''
                }`}
              >
                <div className="flex flex-wrap items-center gap-3 py-2">
                  <h2 className="font-display text-lg text-[#292724]">{new Date(`${dateKey}T00:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
                  {nonWorkingDay ? (
                    <span className="text-xs font-medium text-gray-400">{nonWorkingDay}</span>
                  ) : (
                    <>
                    <button
                      type="button"
                      onClick={() => setAvailabilityTarget(dateKey)}
                      disabled={busy === `availability-${dateKey}`}
                      className="px-1 py-1 text-xs font-semibold text-primary-700 underline decoration-primary-300 underline-offset-4 hover:text-primary-900 disabled:opacity-50"
                    >
                      זמינות
                    </button>
                    {availabilityBlock && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#8b7d84]" />
                        {availabilityBlock.startTime && availabilityBlock.endTime
                          ? `לא זמינה ${availabilityBlock.startTime}–${availabilityBlock.endTime}`
                          : 'לא זמינה כל היום'}
                        {availabilityBlock.reason ? ` · ${availabilityBlock.reason}` : ''}
                      </span>
                    )}
                    </>
                  )}
                </div>
                {shifts.length === 0 ? (
                  <div className="flex min-h-10 items-center px-1 py-1.5">
                    <span className="text-xs text-[var(--color-text-muted)]">{nonWorkingDay ? 'יום מנוחה' : 'אין עבודות'}</span>
                  </div>
                ) : shifts.map((s, index) => (
                <div
                  key={s.jobId}
                  data-worker-shift={s.myShiftId ?? undefined}
                  className={`px-1 py-2 transition-shadow ${
                    index > 0 ? 'border-t border-[var(--color-border)]' : ''
                  } ${
                    focusedShiftId && s.myShiftId === focusedShiftId
                      ? 'ring-2 ring-inset ring-primary-500'
                      : ''
                  }`}
                >
                  <ShiftCard
                    shift={s}
                    busy={busy === s.jobId || (s.myShiftId ? busy === s.myShiftId : false)}
                    onAskToJoin={() => setJoinTarget(s)}
                    onRespond={(accepted) => s.myShiftId && void respondAssignment(s.myShiftId, accepted)}
                    onCancelRequest={() => s.myShiftId && void cancelRequest(s.myShiftId)}
                    onReplacement={() => void openReplacement(s)}
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
      {availabilityTarget && (
        <AvailabilityModal
          dateKey={availabilityTarget}
          existing={availabilityForDate(availability, availabilityTarget)}
          busy={busy === `availability-${availabilityTarget}`}
          onSave={(values, existing) => void saveAvailability(values, existing)}
          onRemove={(blockId) => void removeUnavailable(blockId, availabilityTarget)}
          onClose={() => setAvailabilityTarget(null)}
        />
      )}
      {availabilityConflicts.length > 0 && (
        <AvailabilityConflictModal
          conflicts={availabilityConflicts}
          onReplacement={(shiftId) => {
            const shift = board.find((candidate) => candidate.myShiftId === shiftId);
            if (!shift) return;
            setAvailabilityConflicts([]);
            setAvailabilityTarget(null);
            void openReplacement(shift);
          }}
          onClose={() => setAvailabilityConflicts([])}
        />
      )}
      {replacementTarget && (
        <ReplacementModal
          shift={replacementTarget}
          colleagues={colleagues}
          busy={busy === replacementTarget.myShiftId}
          message={message}
          onSubmit={(reason, suggestedWorkerIds) => void requestReplacement(reason, suggestedWorkerIds)}
          onCancel={() => void cancelReplacement()}
          onClose={() => setReplacementTarget(null)}
        />
      )}
    </div>
  );
}

function AssignedNames({ workers }: { workers: BoardShift['assignedWorkers'] }) {
  if (workers.length === 0) return <span className="text-gray-400">טרם שובצו עובדים</span>;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {workers.map((worker) => (
        <span key={`${worker.name}-${worker.isTeamLeader}`} className="text-sm font-medium text-gray-700">
          {worker.name}{worker.isTeamLeader ? ' · ראש צוות' : ''}
        </span>
      ))}
    </div>
  );
}

function NextShiftDetails({
  shift,
  onReplacement,
}: {
  shift: BoardShift;
  onReplacement: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 text-sm">
      <div className="space-y-2">
        {shift.address && <InlineAddressMap address={shift.address} compact />}
        <AssignedNames workers={shift.assignedWorkers} />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-500">
          {shift.openSpots > 0 ? `${shift.openSpots} מקומות פנויים` : 'הצוות מלא'}
        </span>
        <button
          type="button"
          onClick={onReplacement}
          className="border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          {shift.replacementStatus === 'PENDING' ? 'בקשת מחליפה ממתינה' : 'בקשת מחליפה'}
        </button>
      </div>
    </div>
  );
}

function CardHeader({ shift }: { shift: BoardShift }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="text-sm font-bold text-gray-900">{jobTypeLabel(shift.jobType)}</span>
      <span className="text-sm font-semibold text-gray-900">{shift.customerName}</span>
      <span className="text-sm font-medium tabular-nums text-gray-600" dir="ltr">
        {formatScheduledTime(shift.plannedStart)} – {formatScheduledTime(shift.plannedEnd)}
      </span>
    </div>
  );
}

function CardMeta({ shift }: { shift: BoardShift }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
      {shift.address && <InlineAddressMap address={shift.address} compact />}
      <AssignedNames workers={shift.assignedWorkers} />
    </div>
  );
}

function ShiftCard({
  shift,
  busy,
  onAskToJoin,
  onRespond,
  onCancelRequest,
  onReplacement,
}: {
  shift: BoardShift;
  busy: boolean;
  onAskToJoin: () => void;
  onRespond: (accepted: boolean) => void;
  onCancelRequest: () => void;
  onReplacement: () => void;
}) {
  // 1) Fully assigned (not mine).
  if (shift.myStatus === 'NONE' && shift.openSpots === 0) {
    return (
      <div className="relative px-1">
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
        <p className="mt-1.5 inline-flex rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">העבודה מלאה</p>
      </div>
    );
  }

  // 2) Open spots (not mine): if already booked that date, show as unavailable
  //    (spec §8.1); otherwise click to ask to join.
  if (shift.myStatus === 'NONE' && shift.openSpots > 0) {
    if (shift.blockedSameDay) {
      return (
        <div className={`relative w-full border-r-2 bg-gray-50/50 px-3 py-1 text-right opacity-70 ${jobTypeBorderColor(shift.jobType)}`}>
          <CardHeader shift={shift} />
          <CardMeta shift={shift} />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-0.5 text-[11px] font-medium text-gray-500">
              {shift.openSpots} מקומות פנויים
            </span>
          </div>
          <p className="mt-1.5 text-[11px] font-semibold text-gray-500">כבר יש לך בקשה או שיבוץ בתאריך זה</p>
        </div>
      );
    }
    return (
      <div className={`relative w-full border-r-2 bg-gray-50/50 px-3 py-1 text-right ${jobTypeBorderColor(shift.jobType)}`}>
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">
            {shift.openSpots} מקומות פנויים
          </span>
        </div>
        <button
          type="button"
          onClick={onAskToJoin}
          className="mt-1.5 border border-primary-700 px-3 py-1.5 text-xs font-semibold text-primary-800 hover:bg-primary-50"
        >
          בקשת הצטרפות
        </button>
      </div>
    );
  }

  // 3) Assigned by the owner, awaiting my acceptance: white card + full type border + actions.
  if (shift.myStatus === 'AWAITING_WORKER') {
    return (
      <div className={`border-r-2 pr-4 ${jobTypeBorderColor(shift.jobType)}`}>
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
        <p className="mt-1.5 text-xs font-medium text-amber-800">ממתין לאישורך.</p>
        <div className="mt-1.5 flex gap-2">
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardHeader shift={shift} />
          <div className="flex items-center gap-2">
            <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              מאושרת
            </span>
            <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
              {shift.openSpots > 0 ? `${shift.openSpots} מקומות פנויים` : 'הצוות מלא'}
            </span>
          </div>
        </div>
        <CardMeta shift={shift} />
        <div className="mt-1.5 flex gap-2">
          <button
            type="button"
            onClick={onReplacement}
            className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            {shift.replacementStatus === 'PENDING' ? 'בקשת מחליפה ממתינה' : 'בקשת מחליפה'}
          </button>
        </div>
      </div>
    );
  }

  // 5) My pending join request.
  return (
    <div className="relative block border-r-2 border-amber-300 pr-4">
      <CardHeader shift={shift} />
      <CardMeta shift={shift} />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          ממתין לאישור
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

function ReplacementModal({
  shift,
  colleagues,
  busy,
  message,
  onSubmit,
  onCancel,
  onClose,
}: {
  shift: BoardShift;
  colleagues: { id: string; name: string }[];
  busy: boolean;
  message: string | null;
  onSubmit: (reason: string, suggestedWorkerIds: string[]) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [suggestedWorkerIds, setSuggestedWorkerIds] = useState<string[]>([]);
  const pending = shift.replacementStatus === 'PENDING';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-3 sm:items-center"
      dir="rtl"
      data-testid="replacement-backdrop"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="בקשת מחליפה"
        className="w-full max-w-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-primary-700">בקשת מחליפה</p>
            <h2 className="font-display mt-1 text-2xl text-[#292724]">{jobTypeLabel(shift.jobType)}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              {shortDate(shift.date)} · {formatScheduledTime(shift.plannedStart)}–{formatScheduledTime(shift.plannedEnd)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-gray-500 hover:text-gray-800">
            סגירה
          </button>
        </div>

        {message && (
          <p className="mt-4 border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{message}</p>
        )}

        {pending ? (
          <div className="mt-5 space-y-4">
            <p className="border border-[var(--color-calendar-sand-border)] bg-[var(--color-calendar-sand-soft)] p-3 text-sm text-[var(--color-calendar-sand)]">
              הבקשה ממתינה לאישור. עד לאישור את נשארת משובצת למשמרת.
            </p>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="w-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              ביטול בקשת המחליפה
            </button>
          </div>
        ) : (
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit(reason.trim(), suggestedWorkerIds);
            }}
          >
            <label className="block text-sm font-medium text-gray-700">
              סיבה (רשות)
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={2}
                autoFocus
                maxLength={100}
                className="mt-1 block w-full border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-left text-[11px] font-normal text-gray-400">{reason.length}/100</span>
            </label>
            {colleagues.length > 0 && (
              <fieldset className="block text-sm font-medium text-gray-700">
                <legend>עובדות מסוימות (רשות)</legend>
                <p className="mt-1 text-xs font-normal text-gray-500">ללא בחירה, הבקשה תפורסם לכל העובדות הזמינות.</p>
                <div className="mt-2 grid max-h-32 grid-cols-2 gap-2 overflow-y-auto border border-gray-300 p-2">
                  {colleagues.map((colleague) => (
                    <label key={colleague.id} className="flex items-center gap-2 text-sm font-normal text-gray-700">
                      <input
                        type="checkbox"
                        value={colleague.id}
                        checked={suggestedWorkerIds.includes(colleague.id)}
                        onChange={(event) => setSuggestedWorkerIds((current) =>
                          event.target.checked
                            ? [...current, colleague.id]
                            : current.filter((workerId) => workerId !== colleague.id),
                        )}
                      />
                      {colleague.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="text-xs text-[var(--color-text-secondary)]">
              הבקשה תישלח לאישור. עד לאישור את נשארת משובצת למשמרת.
            </p>
            <button
              type="submit"
              disabled={busy}
              className="w-full bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-50"
            >
              שליחת בקשת מחליפה
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function AvailabilityModal({
  dateKey,
  existing,
  busy,
  onSave,
  onRemove,
  onClose,
}: {
  dateKey: string;
  existing: AvailabilityBlock | null;
  busy: boolean;
  onSave: (
    values: {
      type: 'DATE' | 'RANGE';
      startDate: string;
      endDate?: string;
      reason: string;
      startTime?: string;
      endTime?: string;
    },
    existing: AvailabilityBlock | null,
  ) => void;
  onRemove: (blockId: string) => void;
  onClose: () => void;
}) {
  const initialStartDate = existing?.startDate?.slice(0, 10) ?? dateKey;
  const initialEndDate =
    existing?.type === 'RANGE' && existing.endDate
      ? existing.endDate.slice(0, 10)
      : initialStartDate;
  const [allDay, setAllDay] = useState(!existing?.startTime || !existing?.endTime);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);
  const [startTime, setStartTime] = useState(existing?.startTime ?? '09:00');
  const [endTime, setEndTime] = useState(existing?.endTime ?? '17:00');
  const initialReason = AVAILABILITY_REASONS.includes(existing?.reason as (typeof AVAILABILITY_REASONS)[number])
    ? existing!.reason as (typeof AVAILABILITY_REASONS)[number]
    : existing?.reason
      ? 'אחר'
      : 'חופש';
  const [reason, setReason] = useState<(typeof AVAILABILITY_REASONS)[number]>(initialReason);
  const [otherReason, setOtherReason] = useState(initialReason === 'אחר' ? existing?.reason ?? '' : '');
  const invalidRange = endDate < startDate;
  const invalidHours = !allDay && startTime >= endTime;
  const invalidReason = reason === 'אחר' && !otherReason.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="עדכון זמינות"
        className="w-full max-w-sm bg-[var(--color-surface)] p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[11px] font-semibold tracking-[0.12em] text-primary-700">זמינות</p>
        <h2 className="font-display mt-1 text-2xl text-[#292724]">מתי אינך זמינה?</h2>
        <div className={`mt-4 grid gap-3 ${allDay ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <label className="text-xs text-gray-600">
            {allDay ? 'תאריך התחלה' : 'תאריך'}
            <input
              type="date"
              value={startDate}
              onChange={(event) => {
                const value = event.target.value;
                setStartDate(value);
                if (endDate < value) setEndDate(value);
              }}
              className="mt-1 w-full border border-gray-300 px-2 py-2 text-sm"
            />
          </label>
          {allDay && (
            <label className="text-xs text-gray-600">
              תאריך סיום
              <input
                type="date"
                min={startDate}
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="mt-1 w-full border border-gray-300 px-2 py-2 text-sm"
              />
            </label>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 border border-[var(--color-border-strong)] p-0.5 text-xs">
          <button type="button" onClick={() => setAllDay(true)} className={`px-3 py-2 font-semibold ${allDay ? 'bg-primary-700 text-white' : 'text-gray-600'}`}>
            כל היום
          </button>
          <button
            type="button"
            onClick={() => {
              setAllDay(false);
              setEndDate(startDate);
            }}
            className={`px-3 py-2 font-semibold ${!allDay ? 'bg-primary-700 text-white' : 'text-gray-600'}`}
          >
            שעות מסוימות
          </button>
        </div>
        {!allDay && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-600">
              שעת התחלה
              <input type="time" dir="ltr" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="mt-1 w-full border border-gray-300 px-2 py-2 text-sm" />
            </label>
            <label className="text-xs text-gray-600">
              שעת סיום
              <input type="time" dir="ltr" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="mt-1 w-full border border-gray-300 px-2 py-2 text-sm" />
            </label>
          </div>
        )}
        <label className="mt-4 block text-xs text-gray-600">
          סיבה
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as (typeof AVAILABILITY_REASONS)[number])}
            className="mt-1 w-full border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            {AVAILABILITY_REASONS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        {reason === 'אחר' && (
          <label className="mt-3 block text-xs text-gray-600">
            פירוט
            <input value={otherReason} onChange={(event) => setOtherReason(event.target.value)} maxLength={200} className="mt-1 w-full border border-gray-300 px-3 py-2 text-sm" />
          </label>
        )}
        {invalidRange && <p className="mt-2 text-xs text-rose-600">יש לבחור טווח תאריכים תקין.</p>}
        {invalidHours && <p className="mt-2 text-xs text-rose-600">שעת הסיום חייבת להיות אחרי שעת ההתחלה.</p>}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            disabled={busy || invalidRange || invalidHours || invalidReason}
            onClick={() => onSave({
              type: allDay && startDate !== endDate ? 'RANGE' : 'DATE',
              startDate,
              endDate: allDay && startDate !== endDate ? endDate : undefined,
              reason: reason === 'אחר' ? otherReason.trim() : reason,
              startTime: allDay ? undefined : startTime,
              endTime: allDay ? undefined : endTime,
            }, existing)}
            className="bg-primary-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            סימון כלא זמינה
          </button>
          {existing && (
            <button type="button" disabled={busy} onClick={() => onRemove(existing.id)} className="px-3 py-2 text-xs font-semibold text-[#53644b] disabled:opacity-50">
              סימון כזמינה
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose} className="mr-auto px-2 py-2 text-xs text-gray-500">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function AvailabilityConflictModal({
  conflicts,
  onReplacement,
  onClose,
}: {
  conflicts: AvailabilityConflict[];
  onReplacement: (shiftId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="התנגשות עם עבודה"
        className="w-full max-w-lg bg-[var(--color-surface)] p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900">כבר יש לך עבודה בזמן הזה</h2>
        <p className="mt-1 text-sm text-gray-600">יש למצוא מחליפה לפני שניתן יהיה לשמור את אי-הזמינות.</p>
        <div className="mt-4 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {conflicts.map((conflict) => (
            <div key={conflict.shiftId} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{conflict.customerName}</p>
                <p className="mt-1 text-xs text-gray-600">
                  {shortDate(conflict.date)} · {formatScheduledTime(conflict.plannedStart)}–{formatScheduledTime(conflict.plannedEnd)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onReplacement(conflict.shiftId)}
                className="shrink-0 border border-primary-700 px-3 py-2 text-xs font-semibold text-primary-800 hover:bg-primary-50"
              >
                {conflict.replacementStatus === 'PENDING' ? 'צפייה בבקשה' : 'בקשת מחליפה'}
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-4 w-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">
          חזרה
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
        <p className="text-xs text-gray-500">הבקשה תישלח לאישור. תקבלי הודעה כשהיא תאושר.</p>
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
