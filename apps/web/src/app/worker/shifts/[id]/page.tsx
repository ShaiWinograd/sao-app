'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, MapPin, Clock, CalendarDays, Users, Phone, Navigation, Star, LogIn, LogOut, CheckCircle2, Loader2 } from 'lucide-react';
import { requiresManagerNoteForEndShift } from '@workforce/shared';
import { api, authHeaders } from '../../../../lib/api';
import {
  type WorkerJob,
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
  job: WorkerJob & {
    jobNotes?: string | null;
    customer?: { firstName?: string; lastName?: string; phone?: string | null } | null;
  };
};

export default function WorkerShiftDetailPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const { getToken } = useAuth();
  const [shift, setShift] = useState<ShiftDetail | null>(null);
  const [job, setJob] = useState<WorkerJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [completion, setCompletion] = useState<Completion>('COMPLETED');
  const [note, setNote] = useState('');

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
      setFormOpen(true);
    }
  }, [runAttendance]);

  const submitForm = useCallback(async () => {
    if (!shift) return;
    if (requiresManagerNoteForEndShift(completion) && !note.trim()) {
      setActionMsg('יש להוסיף הערה כשהמשמרת לא הושלמה במלואה.');
      return;
    }
    setBusy(true);
    setActionMsg(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(
        '/forms/submit',
        { shiftId: shift.id, completionStatus: completion, answers: [], managerNote: note.trim() || undefined },
        auth,
      );
      setFormOpen(false);
      setActionMsg('טופס הסיום נשמר. תודה!');
      await load();
    } catch {
      setActionMsg('שמירת הטופס נכשלה.');
    } finally {
      setBusy(false);
    }
  }, [shift, completion, note, getToken, load]);

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
  const mapsHref = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
  const phone = shift.job.customer?.phone;

  return (
    <div className="max-w-2xl space-y-4">
      <BackLink />

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
      {shift.joinRequestStatus === 'APPROVED' && (
        <AttendancePanel
          shift={shift}
          busy={busy}
          onClockIn={() => void runAttendance('/attendance/clock-in')}
          onClockOut={() => void clockOut()}
          onOpenForm={() => {
            setCompletion('COMPLETED');
            setNote('');
            setFormOpen(true);
          }}
        />
      )}
      {actionMsg && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800">{actionMsg}</div>
      )}
      <p className="text-center text-[11px] text-gray-400">בקשות ירידה/החלפה יתווספו בשלב הבא.</p>

      {formOpen && (
        <EndShiftForm
          completion={completion}
          setCompletion={setCompletion}
          note={note}
          setNote={setNote}
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
    <Link href="/worker/calendar" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
      <ArrowRight className="w-4 h-4" />
      חזרה ליומן
    </Link>
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
  onClockIn,
  onClockOut,
  onOpenForm,
}: {
  shift: ShiftDetail;
  busy: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  onOpenForm: () => void;
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
        <p className="flex items-center justify-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4" />
          המשמרת הושלמה והטופס הוגש.
        </p>
      )}
    </div>
  );
}

function EndShiftForm({
  completion,
  setCompletion,
  note,
  setNote,
  busy,
  onSubmit,
  onClose,
}: {
  completion: Completion;
  setCompletion: (c: Completion) => void;
  note: string;
  setNote: (n: string) => void;
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
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
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
        <label className="mt-3 block text-sm">
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
