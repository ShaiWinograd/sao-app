'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, MapPin, Clock, CalendarDays, Users, Phone, Navigation, Star, LogIn, LogOut, CheckCircle2, Loader2, Repeat, X } from 'lucide-react';
import { requiresManagerNoteForEndShift } from '@workforce/shared';
import { api, authHeaders } from '../../../../lib/api';
import {
  type WorkerJob,
  type WorkerFormQuestion,
  type WorkerAnswerValue,
  jobTypeLabel,
  jobTypeClasses,
  formatTime,
  customerName,
  attendanceBadge,
  missingFormBadge,
} from '../../../../lib/worker';

type ShiftDetail = {
  id: string;
  jobId: string;
  slotId?: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  attendanceStatus: string;
  joinRequestStatus: string;
  formStatus: string;
  actualStart?: string | null;
  actualEnd?: string | null;
  replacementStatus?: string;
  replacementRequests?: { id: string; status: string; reason: string; requestedByWorkerId: string }[];
  formSubmission?: {
    id: string;
    completionStatus: string;
    managerNote: string | null;
    editDeadline: string | null;
    answers: { questionId: string; value: string }[];
  } | null;
  job: WorkerJob & {
    jobNotes?: string | null;
    customer?: { firstName?: string; lastName?: string; phone?: string | null } | null;
  };
};

export default function WorkerShiftDetailPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const router = useRouter();
  const { getToken } = useAuth();
  const [shift, setShift] = useState<ShiftDetail | null>(null);
  const [job, setJob] = useState<WorkerJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [completion, setCompletion] = useState<Completion>('COMPLETED');
  const [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Record<string, WorkerAnswerValue>>({});
  const [dropReason, setDropReason] = useState('');
  const [colleagues, setColleagues] = useState<{ id: string; name: string }[]>([]);
  const [suggestedWorkerId, setSuggestedWorkerId] = useState('');
  const [swapColleagueId, setSwapColleagueId] = useState('');
  const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
  const [swapToShiftId, setSwapToShiftId] = useState('');
  const [swapNote, setSwapNote] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const auth = await authHeaders(getToken);
      const shiftRes = await api.get<ShiftDetail>(`/shifts/${id}`, auth);
      setShift(shiftRes.data);
      if (shiftRes.data?.jobId) {
        try {
          const jobRes = await api.get<WorkerJob>(`/jobs/${shiftRes.data.jobId}`, auth);
          setJob(jobRes.data);
        } catch {
          /* roster is best-effort */
        }
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Colleagues list for suggesting a specific replacement. Non-fatal if missing.
  useEffect(() => {
    void (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<{ id: string; name: string }[]>('/workers/colleagues', auth);
        setColleagues(res.data ?? []);
      } catch {
        setColleagues([]);
      }
    })();
  }, [getToken]);

  const isLead = useMemo(() => {
    if (!shift || !job) return false;
    return (job.slots ?? []).some((s) => s.requiredSkill === 'SHIFT_LEADER' && s.filledByShiftId === shift.id);
  }, [shift, job]);

  const roster = useMemo(() => {
    return (job?.shifts ?? [])
      .filter((s) => s.joinRequestStatus === 'APPROVED')
      .map((s) => `${s.worker?.firstName ?? ''} ${s.worker?.lastName ?? ''}`.trim())
      .filter(Boolean);
  }, [job]);

  const runAttendance = useCallback(
    async (endpoint: '/attendance/clock-in' | '/attendance/clock-out') => {
      if (!shift) return false;
      setBusy(true);
      setActionMsg(null);
      try {
        const auth = await authHeaders(getToken);
        const pos = await getBrowserPosition();
        await api.post(endpoint, { shiftId: shift.id, ...pos, timestamp: new Date().toISOString() }, auth);
        await load();
        return true;
      } catch (err) {
        const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
        setActionMsg(data?.error === 'outside_radius' ? data.message ?? 'מחוץ לתחום העבודה.' : 'הפעולה נכשלה. נסי שוב.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [shift, getToken, load],
  );

  const clockOut = useCallback(async () => {
    const ok = await runAttendance('/attendance/clock-out');
    if (ok) {
      setCompletion('COMPLETED');
      setNote('');
      setAnswers({});
      setFormOpen(true);
    }
  }, [runAttendance]);

  const formQuestions = useMemo(
    () =>
      (job?.formTemplate?.questions ?? [])
        .filter((q) => q.visibility === 'WORKER')
        .sort((a, b) => a.order - b.order),
    [job],
  );

  const submitForm = useCallback(async () => {
    if (!shift) return;
    if (requiresManagerNoteForEndShift(completion) && !note.trim()) {
      setActionMsg('יש להוסיף הערה כשהמשמרת לא הושלמה במלואה.');
      return;
    }
    for (const q of formQuestions) {
      if (q.type === 'PHOTO_UPLOAD' || !q.isRequired) continue;
      const v = answers[q.id];
      const empty = v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
      if (empty) {
        setActionMsg(`יש למלא: ${q.questionText}`);
        return;
      }
    }
    setBusy(true);
    setActionMsg(null);
    try {
      const auth = await authHeaders(getToken);
      const answerArr = formQuestions
        .filter((q) => q.type !== 'PHOTO_UPLOAD')
        .filter((q) => {
          const v = answers[q.id];
          return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0);
        })
        .map((q) => ({ questionId: q.id, value: answers[q.id]! }));
      await api.post(
        editMode ? '/forms/edit' : '/forms/submit',
        { shiftId: shift.id, completionStatus: completion, answers: answerArr, managerNote: note.trim() || undefined },
        auth,
      );
      setFormOpen(false);
      setEditMode(false);
      setAnswers({});
      setActionMsg(editMode ? 'הטופס עודכן. תודה!' : 'טופס הסיום נשמר. תודה!');
      await load();
    } catch {
      setActionMsg('שמירת הטופס נכשלה.');
    } finally {
      setBusy(false);
    }
  }, [shift, completion, note, formQuestions, answers, editMode, getToken, load]);

  const openEditForm = useCallback(() => {
    const sub = shift?.formSubmission;
    if (!sub) return;
    setCompletion((sub.completionStatus as Completion) ?? 'COMPLETED');
    setNote(sub.managerNote ?? '');
    const prefilled: Record<string, WorkerAnswerValue> = {};
    for (const a of sub.answers ?? []) {
      try {
        prefilled[a.questionId] = JSON.parse(a.value);
      } catch {
        prefilled[a.questionId] = a.value;
      }
    }
    setAnswers(prefilled);
    setEditMode(true);
    setFormOpen(true);
  }, [shift]);

  const pendingReplacement = useMemo(
    () => (shift?.replacementRequests ?? []).find((r) => r.status === 'PENDING') ?? null,
    [shift],
  );

  const requestReplacement = useCallback(async () => {
    if (!shift) return;
    if (!dropReason.trim()) {
      setActionMsg('יש להוסיף סיבה לבקשה.');
      return;
    }
    setBusy(true);
    setActionMsg(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/shifts/${shift.id}/replacement`, { reason: dropReason.trim(), suggestedWorkerId: suggestedWorkerId || undefined }, auth);
      setDropReason('');
      setSuggestedWorkerId('');
      setActionMsg('הבקשה נשלחה. תישארי משובצת עד לאישור בעל/ת העסק.');
      await load();
    } catch {
      setActionMsg('שליחת הבקשה נכשלה. נסי שוב.');
    } finally {
      setBusy(false);
    }
  }, [shift, dropReason, suggestedWorkerId, getToken, load]);

  const cancelReplacement = useCallback(async () => {
    if (!shift) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const auth = await authHeaders(getToken);
      await api.delete(`/shifts/${shift.id}/replacement`, auth);
      setActionMsg('הבקשה בוטלה.');
      await load();
    } catch {
      setActionMsg('ביטול הבקשה נכשל.');
    } finally {
      setBusy(false);
    }
  }, [shift, getToken, load]);

  // Load the chosen colleague's swappable shifts.
  useEffect(() => {
    setSwapToShiftId('');
    if (!swapColleagueId) {
      setSwapCandidates([]);
      return;
    }
    void (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<SwapCandidate[]>(`/shifts/swaps/candidates/${swapColleagueId}`, auth);
        setSwapCandidates(res.data ?? []);
      } catch {
        setSwapCandidates([]);
      }
    })();
  }, [swapColleagueId, getToken]);

  const proposeSwap = useCallback(async () => {
    if (!shift || !swapToShiftId) return;
    setBusy(true);
    setActionMsg(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/shifts/${shift.id}/swap`, { toShiftId: swapToShiftId, note: swapNote || undefined }, auth);
      setActionMsg('הצעת ההחלפה נשלחה לאישור העובד/ת.');
      setSwapColleagueId('');
      setSwapToShiftId('');
      setSwapNote('');
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionMsg(msg ? `שליחת ההצעה נכשלה: ${msg}` : 'שליחת ההצעה נכשלה.');
    } finally {
      setBusy(false);
    }
  }, [shift, swapToShiftId, swapNote, getToken]);

  const respondAssignment = useCallback(
    async (accepted: boolean) => {
      if (!shift) return;
      setBusy(true);
      setActionMsg(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/${shift.id}/respond-assignment`, { accepted }, auth);
        if (accepted) {
          setActionMsg('אישרת את השיבוץ. המשמרת נוספה ליומן שלך.');
          await load();
        } else {
          router.replace('/worker');
        }
      } catch (err) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setActionMsg(msg ? `הפעולה נכשלה: ${msg}` : 'הפעולה נכשלה.');
      } finally {
        setBusy(false);
      }
    },
    [shift, getToken, load, router],
  );

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;
  if (notFound || !shift) {
    return (
      <div className="max-w-2xl">
        <BackLink />
        <p className="mt-3 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">המשמרת לא נמצאה.</p>
      </div>
    );
  }

  const att = attendanceBadge(shift.attendanceStatus);
  const missingForm = missingFormBadge(shift);
  const address = shift.job.address?.fullAddress ?? '';
  const isCancelled = shift.job.status === 'CANCELLED';
  const isAwaitingAcceptance = shift.joinRequestStatus === 'AWAITING_WORKER';
  const mapsHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
  const phone = shift.job.customer?.phone;

  return (
    <div className="max-w-2xl space-y-4">
      <BackLink />

      {isCancelled && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          העבודה בוטלה. אינך משובץ/ת אליה יותר ואין צורך בפעולה נוספת.
        </div>
      )}

      {isAwaitingAcceptance && !isCancelled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-900">שובצת למשמרת זו – נדרש אישורך</p>
          <p className="text-xs text-amber-800">בעל/ת העסק שיבץ/ה אותך למשמרת. יש לאשר כדי להיקבע, או לדחות כדי לשחרר את המקום.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void respondAssignment(true)}
              disabled={busy}
              className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              אישור השיבוץ
            </button>
            <button
              type="button"
              onClick={() => void respondAssignment(false)}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              דחייה
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${jobTypeClasses(shift.job.jobType)}`}>
            {jobTypeLabel(shift.job.jobType)}
          </span>
          {isLead && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <Star className="w-3.5 h-3.5" />
              ראש צוות
            </span>
          )}
        </div>

        <h1 className="text-lg font-bold text-gray-900">{customerName(shift.job.customer)}</h1>

        <div className="space-y-1.5 text-sm text-gray-700">
          <p className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-gray-400" />
            {new Date(shift.scheduledStart).toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
          </p>
          <p className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            {formatTime(shift.scheduledStart)}–{formatTime(shift.scheduledEnd)}
          </p>
          <p className="flex items-start gap-2">
            <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
            <span>
              {address || 'כתובת תתעדכן'}
              {shift.job.address?.apartmentDetails ? ` · ${shift.job.address.apartmentDetails}` : ''}
            </span>
          </p>
          {isLead && phone && (
            <p className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-gray-400" />
              <a href={`tel:${phone}`} className="text-primary-700 hover:underline">{phone}</a>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {shift.joinRequestStatus === 'PENDING' ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">ממתין לאישור</span>
          ) : (
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${att.className}`}>{att.label}</span>
          )}
          {missingForm && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700">טופס חסר</span>
          )}
        </div>

        {mapsHref && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            <Navigation className="w-3.5 h-3.5" />
            ניווט לכתובת
          </a>
        )}
      </div>

      {/* Access / instructions */}
      {(shift.job.address?.parkingNotes || shift.job.address?.accessNotes || shift.job.address?.elevatorNotes || shift.job.workerVisibleNotes) && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">הנחיות</h2>
          {shift.job.workerVisibleNotes && <NoteRow label="הערות לעבודה" value={shift.job.workerVisibleNotes} />}
          {shift.job.address?.parkingNotes && <NoteRow label="חניה" value={shift.job.address.parkingNotes} />}
          {shift.job.address?.accessNotes && <NoteRow label="גישה" value={shift.job.address.accessNotes} />}
          {shift.job.address?.elevatorNotes && <NoteRow label="מעלית" value={shift.job.address.elevatorNotes} />}
        </div>
      )}

      {/* Roster */}
      {roster.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-2">
            <Users className="w-4 h-4 text-gray-400" />
            צוות המשמרת
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {roster.map((name, i) => (
              <span key={i} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-700">{name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Attendance + end-of-shift form */}
      {shift.joinRequestStatus === 'APPROVED' && !isCancelled && (
        <AttendancePanel
          shift={shift}
          busy={busy}
          canEditForm={
            shift.formStatus === 'SUBMITTED' &&
            !!shift.formSubmission?.editDeadline &&
            Date.now() < new Date(shift.formSubmission.editDeadline).getTime()
          }
          onClockIn={() => void runAttendance('/attendance/clock-in')}
          onClockOut={() => void clockOut()}
          onEditForm={openEditForm}
          onOpenForm={() => {
            setCompletion('COMPLETED');
            setNote('');
            setAnswers({});
            setEditMode(false);
            setFormOpen(true);
          }}
        />
      )}
      {actionMsg && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800">{actionMsg}</div>
      )}

      {/* Drop / replacement request (only before the shift starts) */}
      {shift.joinRequestStatus === 'APPROVED' && shift.attendanceStatus === 'SCHEDULED' && !isCancelled && (
        <DropReplacementPanel
          pending={pendingReplacement}
          within48={new Date(shift.scheduledStart).getTime() - Date.now() < 48 * 3600 * 1000}
          reason={dropReason}
          setReason={setDropReason}
          colleagues={colleagues}
          suggestedWorkerId={suggestedWorkerId}
          setSuggestedWorkerId={setSuggestedWorkerId}
          busy={busy}
          onRequest={() => void requestReplacement()}
          onCancel={() => void cancelReplacement()}
        />
      )}

      {/* Two-way swap proposal (before the shift starts) */}
      {shift.joinRequestStatus === 'APPROVED' && shift.attendanceStatus === 'SCHEDULED' && !isCancelled && colleagues.length > 0 && (
        <SwapProposePanel
          colleagues={colleagues}
          colleagueId={swapColleagueId}
          setColleagueId={setSwapColleagueId}
          candidates={swapCandidates}
          toShiftId={swapToShiftId}
          setToShiftId={setSwapToShiftId}
          note={swapNote}
          setNote={setSwapNote}
          busy={busy}
          onPropose={() => void proposeSwap()}
        />
      )}

      {formOpen && (
        <EndShiftForm
          completion={completion}
          setCompletion={setCompletion}
          note={note}
          setNote={setNote}
          questions={formQuestions}
          answers={answers}
          onAnswer={(id, value) => setAnswers((prev) => ({ ...prev, [id]: value }))}
          busy={busy}
          onSubmit={() => void submitForm()}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}

function NoteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <span className="text-xs font-medium text-gray-500">{label}: </span>
      <span className="text-gray-700">{value}</span>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/worker" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
      <ArrowRight className="w-4 h-4" />
      חזרה למשמרות
    </Link>
  );
}

type SwapCandidate = {
  shiftId: string;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  jobType: string;
  customerName: string;
};

function SwapProposePanel({
  colleagues,
  colleagueId,
  setColleagueId,
  candidates,
  toShiftId,
  setToShiftId,
  note,
  setNote,
  busy,
  onPropose,
}: {
  colleagues: { id: string; name: string }[];
  colleagueId: string;
  setColleagueId: (v: string) => void;
  candidates: SwapCandidate[];
  toShiftId: string;
  setToShiftId: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  busy: boolean;
  onPropose: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Repeat className="w-4 h-4 text-gray-400" />
        החלפת משמרות עם עובד/ת אחר/ת
      </h2>
      <p className="text-xs text-gray-500">בחר/י עובד/ת ומשמרת שלה/ו להחלפה. ההחלפה תתבצע רק לאחר אישור העובד/ת ובעל/ת העסק.</p>
      <label className="block text-xs text-gray-600">
        עובד/ת
        <select
          value={colleagueId}
          onChange={(e) => setColleagueId(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">בחר/י עובד/ת</option>
          {colleagues.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {colleagueId && candidates.length === 0 && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">אין לעובד/ת זו משמרות זמינות להחלפה.</p>
      )}
      {candidates.length > 0 && (
        <label className="block text-xs text-gray-600">
          המשמרת שלה/ו
          <select
            value={toShiftId}
            onChange={(e) => setToShiftId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">בחר/י משמרת</option>
            {candidates.map((c) => (
              <option key={c.shiftId} value={c.shiftId}>
                {new Date(c.date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} · {jobTypeLabel(c.jobType)} · {formatTime(c.plannedStart)}–{formatTime(c.plannedEnd)}
              </option>
            ))}
          </select>
        </label>
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="הערה (רשות)"
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={onPropose}
        disabled={busy || !toShiftId}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        שליחת הצעת החלפה
      </button>
    </div>
  );
}

function DropReplacementPanel({
  pending,
  within48,
  reason,
  setReason,
  colleagues,
  suggestedWorkerId,
  setSuggestedWorkerId,
  busy,
  onRequest,
  onCancel,
}: {
  pending: { id: string; status: string; reason: string } | null;
  within48: boolean;
  reason: string;
  setReason: (v: string) => void;
  colleagues: { id: string; name: string }[];
  suggestedWorkerId: string;
  setSuggestedWorkerId: (v: string) => void;
  busy: boolean;
  onRequest: () => void;
  onCancel: () => void;
}) {
  if (pending) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          <Repeat className="w-4 h-4" />
          בקשת החלפה נשלחה
        </p>
        <p className="text-xs text-amber-700">הבקשה ממתינה לאישור בעל/ת העסק. עד לאישור את נשארת משובצת למשמרת.</p>
        {pending.reason && <p className="text-xs text-amber-700">סיבה: {pending.reason}</p>}
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
          ביטול הבקשה
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Repeat className="w-4 h-4 text-gray-400" />
        ירידה מהמשמרת / בקשת החלפה
      </h2>
      {within48 ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          לא ניתן לרדת מהמשמרת פחות מ-48 שעות לפני תחילתה. אפשר לבקש החלפה עם עובד/ת אחר/ת.
        </p>
      ) : (
        <p className="text-xs text-gray-500">הבקשה תישלח לאישור בעל/ת העסק. עד לאישור את נשארת משובצת למשמרת.</p>
      )}
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="סיבת הבקשה"
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      {colleagues.length > 0 && (
        <label className="block text-xs text-gray-600">
          הצעת עובד/ת ספציפי/ת (רשות)
          <select
            value={suggestedWorkerId}
            onChange={(e) => setSuggestedWorkerId(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">ללא הצעה — פתוח לכלם</option>
            {colleagues.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={onRequest}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {within48 ? 'בקשת החלפה' : 'שליחת בקשה'}
      </button>
    </div>
  );
}

type Completion = 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED';

function getBrowserPosition(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ latitude: 0, longitude: 0 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve({ latitude: 0, longitude: 0 }),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}

function AttendancePanel({
  shift,
  busy,
  canEditForm,
  onClockIn,
  onClockOut,
  onOpenForm,
  onEditForm,
}: {
  shift: ShiftDetail;
  busy: boolean;
  canEditForm: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  onOpenForm: () => void;
  onEditForm: () => void;
}) {
  const clockedOut = ['CLOCKED_OUT', 'CORRECTED', 'AUTO_CLOCKED_OUT'].includes(shift.attendanceStatus);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {shift.attendanceStatus === 'SCHEDULED' && (
        <button
          type="button"
          onClick={onClockIn}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          כניסה למשמרת
        </button>
      )}
      {shift.attendanceStatus === 'CLOCKED_IN' && (
        <button
          type="button"
          onClick={onClockOut}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          סיום משמרת
        </button>
      )}
      {clockedOut && shift.formStatus === 'NOT_SUBMITTED' && (
        <button
          type="button"
          onClick={onOpenForm}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          מילוי טופס סיום משמרת
        </button>
      )}
      {clockedOut && shift.formStatus !== 'NOT_SUBMITTED' && (
        <div className="space-y-2 text-center">
          <p className="flex items-center justify-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            המשמרת הושלמה והטופס הוגש.
          </p>
          {canEditForm && (
            <button
              type="button"
              onClick={onEditForm}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              עריכת הטופס
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EndShiftForm({
  completion,
  setCompletion,
  note,
  setNote,
  questions,
  answers,
  onAnswer,
  busy,
  onSubmit,
  onClose,
}: {
  completion: Completion;
  setCompletion: (c: Completion) => void;
  note: string;
  setNote: (n: string) => void;
  questions: WorkerFormQuestion[];
  answers: Record<string, WorkerAnswerValue>;
  onAnswer: (id: string, value: WorkerAnswerValue) => void;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const options: [Completion, string][] = [
    ['COMPLETED', 'הושלמה במלואה'],
    ['PARTIALLY_COMPLETED', 'הושלמה חלקית'],
    ['NOT_COMPLETED', 'לא הושלמה'],
  ];
  const noteRequired = requiresManagerNoteForEndShift(completion);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-xl bg-white p-5 shadow-xl" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900">טופס סיום משמרת</h3>
        <p className="mt-1 text-xs text-gray-500">איך הסתיימה המשמרת?</p>
        <div className="mt-3 space-y-1.5">
          {options.map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 text-sm text-gray-800">
              <input type="radio" name="completion" checked={completion === val} onChange={() => setCompletion(val)} />
              {label}
            </label>
          ))}
        </div>

        {questions.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-gray-100 pt-3">
            {questions.map((q) => (
              <QuestionField key={q.id} q={q} value={answers[q.id]} onChange={(v) => onAnswer(q.id, v)} />
            ))}
          </div>
        )}

        <label className="mt-4 block text-sm">
          <span className="text-gray-600">הערה {noteRequired ? '(חובה)' : '(רשות)'}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy}
            className="flex-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            שמירה
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionField({
  q,
  value,
  onChange,
}: {
  q: WorkerFormQuestion;
  value: WorkerAnswerValue | undefined;
  onChange: (value: WorkerAnswerValue) => void;
}) {
  const label = (
    <span className="text-sm text-gray-800">
      {q.questionText}
      {q.isRequired && <span className="text-rose-500"> *</span>}
    </span>
  );
  const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm';

  if (q.type === 'YES_NO') {
    return (
      <div>
        {label}
        <div className="mt-1 flex gap-4">
          {[['yes', 'כן', true], ['no', 'לא', false]].map(([key, text, val]) => (
            <label key={key as string} className="flex items-center gap-1.5 text-sm text-gray-800">
              <input type="radio" name={q.id} checked={value === val} onChange={() => onChange(val as boolean)} />
              {text as string}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (q.type === 'MULTIPLE_CHOICE') {
    return (
      <div>
        {label}
        <div className="mt-1 space-y-1">
          {q.options.map((opt) => (
            <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-800">
              <input type="radio" name={q.id} checked={value === opt} onChange={() => onChange(opt)} />
              {opt}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (q.type === 'CHECKBOX') {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div>
        {label}
        <div className="mt-1 space-y-1">
          {q.options.map((opt) => (
            <label key={opt} className="flex items-center gap-1.5 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={arr.includes(opt)}
                onChange={(e) => onChange(e.target.checked ? [...arr, opt] : arr.filter((o) => o !== opt))}
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
    );
  }

  if (q.type === 'NUMBER') {
    return (
      <label className="block">
        {label}
        <input
          type="number"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={inputClass}
        />
      </label>
    );
  }

  if (q.type === 'LONG_TEXT') {
    return (
      <label className="block">
        {label}
        <textarea value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} rows={2} className={inputClass} />
      </label>
    );
  }

  if (q.type === 'DATE') {
    return (
      <label className="block">
        {label}
        <input type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      </label>
    );
  }

  if (q.type === 'PHOTO_UPLOAD') {
    return (
      <div>
        {label}
        <p className="mt-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          צירוף תמונות זמין באפליקציה הניידת.
        </p>
      </div>
    );
  }

  // SHORT_TEXT and SIGNATURE
  return (
    <label className="block">
      {label}
      <input
        type="text"
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={q.type === 'SIGNATURE' ? 'שם מלא לאישור' : undefined}
        className={inputClass}
      />
    </label>
  );
}
