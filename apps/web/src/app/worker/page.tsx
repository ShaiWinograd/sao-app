'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { Clock, MapPin, Users, Star, Repeat, Check, X } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';
import {
  jobTypeLabel,
  jobTypeSolidClasses,
  jobTypeBorderColor,
  jobTypeStripColor,
  jobTypeTintClasses,
  formatTime,
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export default function WorkerShiftsPage() {
  const { getToken } = useAuth();
  const [board, setBoard] = useState<BoardShift[]>([]);
  const [swaps, setSwaps] = useState<SwapMine[]>([]);
  const [replacements, setReplacements] = useState<OpenReplacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joinTarget, setJoinTarget] = useState<BoardShift | null>(null);

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

  useEffect(() => {
    void (async () => {
      await Promise.all([loadBoard(), loadSwaps(), loadReplacements()]);
      setLoading(false);
    })();
  }, [loadBoard, loadSwaps, loadReplacements]);

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
  const visible = tab === 'all' ? board : myShifts;

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-bold text-gray-900">המשמרות</h1>

      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
        {([['all', 'כל המשמרות'], ['mine', 'היומן שלי']] as [typeof tab, string][]).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={`rounded-md px-3 py-1.5 font-medium ${tab === v ? 'bg-primary-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}
          >
            {label}
            {v === 'mine' && myShifts.length > 0 ? ` (${myShifts.length})` : ''}
          </button>
        ))}
      </div>

      {message && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800">{message}</div>
      )}

      {tab === 'mine' && swaps.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Repeat className="w-4 h-4 text-gray-400" />
            בקשות החלפת משמרות
          </h2>
          {swaps.map((s) => (
            <div key={s.id} className="rounded-xl border border-gray-200 bg-white p-3 space-y-2 text-xs">
              <p className="font-semibold text-gray-900">
                {s.direction === 'INCOMING' ? `${s.counterpartName} מציע/ה החלפה` : `הצעת החלפה ל${s.counterpartName}`}
                {' · '}
                <span className={s.status === 'PENDING_WORKER' ? 'text-amber-700' : 'text-blue-700'}>
                  {s.status === 'PENDING_WORKER' ? 'ממתין לאישור העובד/ת' : 'ממתין לבעל/ת העסק'}
                </span>
              </p>
              <p className="text-gray-600">
                המשמרת שלך: {shortDate(s.myShift.date)} {formatTime(s.myShift.plannedStart)}–{formatTime(s.myShift.plannedEnd)} · שלה/ו: {shortDate(s.theirShift.date)} {formatTime(s.theirShift.plannedStart)}–{formatTime(s.theirShift.plannedEnd)}
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

      {visible.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          {tab === 'all' ? 'אין משמרות מתוזמנות כרגע.' : 'אין לך משמרות משובצות.'}
        </p>
      ) : (
        <div className="space-y-2.5">
          {visible.map((s) => (
            <ShiftCard
              key={s.jobId}
              shift={s}
              busy={busy === s.jobId || (s.myShiftId ? busy === s.myShiftId : false)}
              onAskToJoin={() => setJoinTarget(s)}
              onRespond={(accepted) => s.myShiftId && void respondAssignment(s.myShiftId, accepted)}
              onCancelRequest={() => s.myShiftId && void cancelRequest(s.myShiftId)}
            />
          ))}
        </div>
      )}

      {tab === 'all' && replacements.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            <Repeat className="w-4 h-4 text-gray-400" />
            משמרות הדורשות החלפה
          </h2>
          {replacements.map((r) => (
            <div key={r.requestId} className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-4 pr-5">
              <span className={`absolute inset-y-0 right-0 w-1.5 ${jobTypeStripColor(r.jobType)}`} />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-gray-900">{jobTypeLabel(r.jobType)}</span>
                <span className="text-xs font-medium text-gray-600">{shortDate(r.date)}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-gray-900">{r.customerName}</p>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
                <Clock className="w-3.5 h-3.5" />
                {formatTime(r.plannedStart)}–{formatTime(r.plannedEnd)}
              </p>
              {r.suggestedForYou && (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">
                  <Star className="w-3 h-3" />
                  הוצעת להחלפה זו
                </span>
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

function AssignedNames({ workers, light }: { workers: BoardShift['assignedWorkers']; light?: boolean }) {
  if (workers.length === 0) return <span className={light ? 'text-white/80' : 'text-gray-400'}>טרם שובצו עובדים</span>;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {workers.map((w, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] ${
            light ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          {w.isTeamLeader && <Star className="w-3 h-3" />}
          {w.name}
        </span>
      ))}
    </span>
  );
}

function CardHeader({ shift, light }: { shift: BoardShift; light?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-sm font-bold ${light ? 'text-white' : 'text-gray-900'}`}>{jobTypeLabel(shift.jobType)}</span>
      <span className={`text-xs font-medium ${light ? 'text-white/90' : 'text-gray-600'}`}>{shortDate(shift.date)}</span>
    </div>
  );
}

function CardMeta({ shift, light }: { shift: BoardShift; light?: boolean }) {
  const sub = light ? 'text-white/90' : 'text-gray-600';
  return (
    <>
      <p className={`mt-1 text-sm font-semibold ${light ? 'text-white' : 'text-gray-900'}`}>{shift.customerName}</p>
      <p className={`mt-0.5 flex items-center gap-1 text-xs ${sub}`}>
        <Clock className="w-3.5 h-3.5" />
        {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)}
      </p>
      {shift.address && (
        <p className={`mt-0.5 flex items-center gap-1 text-xs ${sub}`}>
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          {shift.address}
        </p>
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
  // 1) Fully assigned (not mine): solid type-color fill.
  if (shift.myStatus === 'NONE' && shift.openSpots === 0) {
    return (
      <div className={`rounded-xl p-4 ${jobTypeSolidClasses(shift.jobType)}`}>
        <CardHeader shift={shift} light />
        <CardMeta shift={shift} light />
        <div className="mt-2 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-white/80" />
          <AssignedNames workers={shift.assignedWorkers} light />
        </div>
        <p className="mt-2 text-[11px] font-semibold text-white/90">העבודה מלאה</p>
      </div>
    );
  }

  // 2) Open spots (not mine): if already booked that date, show as unavailable
  //    (spec §8.1); otherwise click to ask to join.
  if (shift.myStatus === 'NONE' && shift.openSpots > 0) {
    if (shift.blockedSameDay) {
      return (
        <div className="relative w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-4 pr-5 text-right opacity-70">
          <span className={`absolute inset-y-0 right-0 w-1.5 ${jobTypeStripColor(shift.jobType)}`} />
          <CardHeader shift={shift} />
          <CardMeta shift={shift} />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500">
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
        className="relative w-full overflow-hidden rounded-xl border border-gray-200 bg-white p-4 pr-5 text-right hover:shadow-sm"
      >
        <span className={`absolute inset-y-0 right-0 w-1.5 ${jobTypeStripColor(shift.jobType)}`} />
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
      <div className={`rounded-xl border-2 ${jobTypeBorderColor(shift.jobType)} bg-white p-4`}>
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
        <p className="mt-2 text-xs font-medium text-amber-800">שובצת למשמרת זו – יש לאשר או לדחות.</p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onRespond(true)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            אישור
          </button>
          <button
            type="button"
            onClick={() => onRespond(false)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            דחייה
          </button>
        </div>
      </div>
    );
  }

  // 4) My confirmed shift: tinted card + full type border + swap/drop.
  if (shift.myStatus === 'APPROVED') {
    return (
      <div className={`rounded-xl border-2 ${jobTypeBorderColor(shift.jobType)} ${jobTypeTintClasses(shift.jobType)} p-4`}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-gray-900">{jobTypeLabel(shift.jobType)}</span>
          <span className="inline-flex items-center rounded-full border border-primary-300 bg-primary-100 px-2 py-0.5 text-[11px] font-semibold text-primary-800">
            את/ה משובץ/ת
          </span>
        </div>
        <CardMeta shift={shift} />
        <div className="mt-2 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-gray-400" />
          <AssignedNames workers={shift.assignedWorkers} />
        </div>
        <div className="mt-2 flex gap-2">
          <Link
            href={`/worker/shifts/${shift.myShiftId}`}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Repeat className="w-3.5 h-3.5" />
            החלפה
          </Link>
          <Link
            href={`/worker/shifts/${shift.myShiftId}`}
            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
          >
            ירידה מהמשמרת
          </Link>
        </div>
      </div>
    );
  }

  // 5) My pending join request.
  return (
    <div className="relative block overflow-hidden rounded-xl border border-gray-200 bg-white p-4 pr-5">
      <span className={`absolute inset-y-0 right-0 w-1.5 ${jobTypeStripColor(shift.jobType)}`} />
      <Link href={shift.myShiftId ? `/worker/shifts/${shift.myShiftId}` : '#'} className="block hover:opacity-90">
        <CardHeader shift={shift} />
        <CardMeta shift={shift} />
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
          ממתין לאישור בעל/ת העסק
        </span>
        <button
          type="button"
          onClick={onCancelRequest}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
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
      <div className="w-full max-w-sm rounded-xl bg-white p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold text-gray-900">בקשה להצטרף למשמרת</h2>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          <p className="font-semibold text-gray-900">{jobTypeLabel(shift.jobType)} · {shift.customerName}</p>
          <p className="mt-0.5 text-xs text-gray-600">
            {shortDate(shift.date)} · {formatTime(shift.plannedStart)}–{formatTime(shift.plannedEnd)}
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
