'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, CheckCircle2, RefreshCw, Send, UserCheck, XCircle, Repeat } from 'lucide-react';
import { evaluateJobPublishReadiness, MANAGER_SKILL, deriveJobStatusBadge } from '@workforce/shared';
import { api, authHeaders } from '../../../lib/api';
import { StatusBadge } from '../../../components/ui/StatusBadge';

type ApiJobSlot = {
  id: string;
  requiredSkill: string | null;
  label: string | null;
  filledByShiftId: string | null;
};

type ApiJobShift = {
  id: string;
  slotId: string | null;
  workerNameSnapshot: string;
  attendanceStatus: string;
  joinRequestStatus: string;
  assignmentRole?: string;
  formStatus: string;
  worker?: { firstName: string; lastName: string } | null;
  replacementRequests?: {
    id: string;
    reason: string;
    status: string;
    volunteers?: { worker: { id: string; firstName: string; lastName: string; skills: string[] } }[];
  }[];
};

type ApiJobDetail = {
  id: string;
  caseId: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: string;
  plannedStart: string;
  plannedEnd: string;
  status: string;
  requiredWorkerCount: number;
  addressId: string | null;
  jobNotes: string | null;
  workerVisibleNotes: string | null;
  address?: { fullAddress: string } | null;
  customer: { firstName: string; lastName: string; phone: string; isSystem?: boolean };
  slots: ApiJobSlot[];
  shifts: ApiJobShift[];
};

type JobTab = 'details' | 'staffing' | 'attendance' | 'forms' | 'notes' | 'activity';

const JOB_TYPE_LABELS: Record<ApiJobDetail['jobType'], string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

const JOB_STATUS_LABELS: Record<string, string> = {
  RESERVATION: 'שריון',
  APPROVED: 'אושר',
  COMPLETED: 'בוצע',
  ARCHIVED: 'בארכיון',
};

// Friendly Hebrew labels for the audit-log `reason` values (spec §16).
const ACTIVITY_LABELS: Record<string, string> = {
  'created+published': 'העבודה נוצרה ופורסמה',
  approve: 'העבודה אושרה',
  'return-to-reservation': 'הוחזרה לשריון',
  archive: 'הועברה לארכיון',
  republish: 'נשלחה שוב לעובדים',
  update: 'עודכנו פרטים',
  'material-change': 'שינוי מהותי – נדרש אישור עובדים מחדש',
  'move-worker': 'עובד הועבר לעבודה זו',
  'role-change': 'שינוי תפקיד עובד',
  'join-request': 'עובד ביקש להצטרף',
  'join-decision': 'הוכרעה בקשת הצטרפות',
  'join-request-cancelled': 'עובד ביטל בקשת הצטרפות',
  'direct-assign': 'שיבוץ ישיר של עובד',
  'assignment-accepted': 'עובד אישר שיבוץ',
  'assignment-declined': 'עובד דחה שיבוץ',
  'admin-remove': 'עובד הוסר מהעבודה',
};

const JOIN_STATUS_LABELS: Record<string, string> = {
  PENDING: 'ממתין לאישור',
  AWAITING_WORKER: 'ממתין לאישור העובד/ת',
  APPROVED: 'מאושר',
  REJECTED: 'נדחה',
  CANCELLED: 'בוטל',
};

const ATTENDANCE_LABELS: Record<string, string> = {
  SCHEDULED: 'טרם החל',
  CLOCKED_IN: 'נכנס',
  CLOCKED_OUT: 'סיים',
  AUTO_CLOCKED_OUT: 'סיים (אוטומטי)',
  NO_SHOW: 'לא הגיע',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('he-IL');
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = params?.id;
  const { getToken } = useAuth();

  const [tab, setTab] = useState<JobTab>('details');
  const [job, setJob] = useState<ApiJobDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignSlotId, setAssignSlotId] = useState<string | null>(null);
  const [assignCandidates, setAssignCandidates] = useState<Array<{ id: string; name: string; available: boolean }>>([]);
  const [assignWorkerId, setAssignWorkerId] = useState('');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargets, setMoveTargets] = useState<Array<{ id: string; label: string }>>([]);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moveSelected, setMoveSelected] = useState<Record<string, boolean>>({});
  const [deleteReason, setDeleteReason] = useState('');
  const [activity, setActivity] = useState<
    Array<{ id: string; action: string; entityType: string; reason: string | null; createdAt: string; performedBy?: { firstName: string; lastName: string } | null }>
  >([]);

  const load = useCallback(async () => {
    if (!jobId) return;
    setIsLoading(true);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<ApiJobDetail>(`/jobs/${jobId}`, auth);
      setJob(res.data);
    } catch {
      setError('טעינת העבודה נכשלה');
    } finally {
      setIsLoading(false);
    }
  }, [jobId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const readiness = useMemo(() => {
    if (!job) return null;
    return evaluateJobPublishReadiness({
      status: job.status,
      requiredWorkerCount: job.requiredWorkerCount,
      slotCount: job.slots.length,
      plannedStart: job.plannedStart,
      plannedEnd: job.plannedEnd,
      hasAddress: Boolean(job.addressId),
    });
  }, [job]);

  const publish = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/jobs/${jobId}/publish`, {}, auth);
      await load();
    } catch {
      setError('פרסום העבודה נכשל — ודאי שכל תנאי המוכנות מתקיימים');
    } finally {
      setBusy(false);
    }
  }, [jobId, getToken, load]);

  const approveJob = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/jobs/${jobId}/approve`, {}, auth);
      await load();
    } catch (err) {
      const res = (err as { response?: { data?: { error?: string } } })?.response;
      setError(res?.data?.error ?? 'אישור העבודה נכשל');
    } finally {
      setBusy(false);
    }
  }, [jobId, getToken, load]);

  const returnToReservation = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/jobs/${jobId}/return-to-reservation`, {}, auth);
      await load();
    } catch (err) {
      const res = (err as { response?: { data?: { error?: string } } })?.response;
      setError(res?.data?.error ?? 'החזרה לשריון נכשלה');
    } finally {
      setBusy(false);
    }
  }, [jobId, getToken, load]);

  const archiveJob = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/jobs/${jobId}/cancel`, {}, auth);
      await load();
    } catch (err) {
      const res = (err as { response?: { data?: { error?: string } } })?.response;
      setError(res?.data?.error ?? 'העברה לארכיון נכשלה');
    } finally {
      setBusy(false);
    }
  }, [jobId, getToken, load]);

  const deleteJob = useCallback(
    async (reason: string) => {
      if (!jobId) return;
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.delete(`/jobs/${jobId}`, { ...auth, data: { reason } });
        window.location.href = '/jobs';
      } catch (err) {
        const res = (err as { response?: { status?: number; data?: { message?: string; error?: string } } })?.response;
        if (res?.status === 409) {
          setError(res.data?.message ?? 'לא ניתן למחוק עבודה עם נתוני נוכחות. ניתן להעביר לארכיון בלבד.');
        } else {
          setError(res?.data?.error ?? 'מחיקת העבודה נכשלה');
        }
      } finally {
        setBusy(false);
      }
    },
    [jobId, getToken],
  );

  const loadActivity = useCallback(async () => {
    if (!jobId) return;
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<typeof activity>(`/jobs/${jobId}/activity`, auth);
      setActivity(res.data);
    } catch {
      /* non-critical */
    }
  }, [jobId, getToken]);

  useEffect(() => {
    if (tab === 'activity') void loadActivity();
  }, [tab, loadActivity]);

  const decideJoinRequest = useCallback(
    async (shiftId: string, approved: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/${shiftId}/approve`, { approved }, auth);
        await load();
      } catch {
        setError('עדכון בקשת השיבוץ נכשל');
      } finally {
        setBusy(false);
      }
    },
    [getToken, load],
  );

  const changeRole = useCallback(
    async (shiftId: string, role: string) => {
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/${shiftId}/role`, { role }, auth);
        await load();
      } catch (err) {
        const res = (err as { response?: { data?: { error?: string } } })?.response;
        setError(res?.data?.error ?? 'עדכון תפקיד העובד/ת נכשל');
      } finally {
        setBusy(false);
      }
    },
    [getToken, load],
  );

  const openMove = useCallback(async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<Array<{ id: string; jobType: string; customer: { firstName: string; lastName: string } }>>(
        `/jobs?date=${encodeURIComponent(job.date)}`,
        auth,
      );
      const targets = res.data
        .filter((j) => j.id !== job.id)
        .map((j) => ({
          id: j.id,
          label: `${JOB_TYPE_LABELS[j.jobType as ApiJobDetail['jobType']] ?? j.jobType} · ${j.customer.firstName} ${j.customer.lastName}`,
        }));
      setMoveTargets(targets);
      setMoveTargetId(targets[0]?.id ?? '');
      setMoveSelected({});
      setMoveOpen(true);
    } catch {
      setError('טעינת עבודות היעד נכשלה');
    } finally {
      setBusy(false);
    }
  }, [job, getToken]);

  const submitMove = useCallback(async () => {
    if (!job || !moveTargetId) return;
    const shiftIds = Object.keys(moveSelected).filter((k) => moveSelected[k]);
    if (!shiftIds.length) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post('/jobs/move-workers', { sourceJobId: job.id, targetJobId: moveTargetId, shiftIds }, auth);
      setMoveOpen(false);
      await load();
    } catch (err) {
      const res = (err as { response?: { data?: { error?: string } } })?.response;
      setError(res?.data?.error ?? 'העברת העובדים נכשלה');
    } finally {
      setBusy(false);
    }
  }, [job, moveTargetId, moveSelected, getToken, load]);

  const resolveReplacement = useCallback(
    async (requestId: string, approved: boolean, approvedWorkerId?: string) => {
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/replacement/${requestId}/resolve`, { approved, approvedWorkerId }, auth);
        await load();
      } catch (err) {
        const res = (err as { response?: { status?: number; data?: { error?: string; message?: string } } })?.response;
        if (approved && res?.status === 409 && res.data?.error === 'team_leader_coverage') {
          const msg = res.data.message ?? 'שחרור העובד/ת יותיר את המשמרת ללא ראש צוות. לאשר בכל זאת?';
          if (typeof window !== 'undefined' && window.confirm(msg)) {
            try {
              const auth = await authHeaders(getToken);
              await api.post(`/shifts/replacement/${requestId}/resolve`, { approved, approvedWorkerId, override: true }, auth);
              await load();
            } catch {
              setError('עדכון בקשת ההחלפה נכשל');
            }
          }
        } else {
          setError('עדכון בקשת ההחלפה נכשל');
        }
      } finally {
        setBusy(false);
      }
    },
    [getToken, load],
  );

  const managerSlots = useMemo(
    () => (job ? job.slots.filter((slot) => slot.requiredSkill === MANAGER_SKILL) : []),
    [job],
  );
  const workerSlots = useMemo(
    () => (job ? job.slots.filter((slot) => slot.requiredSkill !== MANAGER_SKILL) : []),
    [job],
  );

  const shiftForSlot = useCallback(
    (slotId: string) => job?.shifts.find((shift) => shift.slotId === slotId) ?? null,
    [job],
  );

  const openAssign = useCallback(
    async (slot: { id: string; requiredSkill: string | null }) => {
      if (!job) return;
      setAssignSlotId(slot.id);
      setAssignWorkerId('');
      setAssignCandidates([]);
      try {
        const auth = await authHeaders(getToken);
        const date = job.date.slice(0, 10);
        const requiresManager = slot.requiredSkill === MANAGER_SKILL;
        const skillParam = slot.requiredSkill ? `&skill=${encodeURIComponent(slot.requiredSkill)}` : '';
        const res = await api.get<Array<{ id: string; name: string; available: boolean }>>(
          `/workers/availability?date=${date}${skillParam}&requiresManager=${requiresManager}`,
          auth,
        );
        setAssignCandidates(res.data);
      } catch {
        setError('טעינת העובדים הזמינים נכשלה');
      }
    },
    [job, getToken],
  );

  const assignWorker = useCallback(async () => {
    if (!job || !assignSlotId || !assignWorkerId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post('/shifts/admin-assign', { jobId: job.id, workerId: assignWorkerId, slotId: assignSlotId }, auth);
      setAssignSlotId(null);
      setAssignWorkerId('');
      await load();
    } catch {
      setError('שיבוץ העובד נכשל (ייתכן שהעובד כבר משובץ באותו יום או שהעמדה תפוסה)');
    } finally {
      setBusy(false);
    }
  }, [job, assignSlotId, assignWorkerId, getToken, load]);

  const removeShift = useCallback(
    async (shiftId: string, workerName: string) => {
      if (typeof window !== 'undefined' && !window.confirm(`להסיר את ${workerName} מהעבודה? הפעולה תפנה את העמדה.`)) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.delete(`/shifts/${shiftId}`, auth);
        await load();
      } catch {
        setError('הסרת העובד נכשלה (ייתכן שהעובד כבר דיווח נוכחות)');
      } finally {
        setBusy(false);
      }
    },
    [getToken, load],
  );

  const jobBadge = useMemo(() => {
    if (!job) return null;
    const assignedWorkerCount = workerSlots.filter((slot) => shiftForSlot(slot.id)).length;
    return deriveJobStatusBadge({
      status: job.status,
      requiredWorkerCount: workerSlots.length,
      assignedWorkerCount,
      requiresManager: managerSlots.length > 0,
      hasManager: managerSlots.some((slot) => shiftForSlot(slot.id)),
    });
  }, [job, workerSlots, managerSlots, shiftForSlot]);

  const renderShiftStatus = (shift: ApiJobShift) => {
    const pendingReplacement = (shift.replacementRequests ?? []).find((r) => r.status === 'PENDING');
    return (
      <div className="flex flex-col items-end gap-1">
        {shift.joinRequestStatus === 'PENDING' ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void decideJoinRequest(shift.id, true)}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              אישור
            </button>
            <button
              onClick={() => void decideJoinRequest(shift.id, false)}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
              דחייה
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {(shift.joinRequestStatus === 'APPROVED' || shift.joinRequestStatus === 'AWAITING_WORKER') && (
              <select
                value={shift.assignmentRole ?? 'REGULAR'}
                onChange={(e) => void changeRole(shift.id, e.target.value)}
                disabled={busy}
                title="תפקיד בעבודה"
                className="text-[11px] rounded-lg border border-gray-200 bg-white px-1.5 py-1 text-gray-700 disabled:opacity-50"
              >
                <option value="REGULAR">עובד</option>
                <option value="TEAM_LEADER">ראש צוות</option>
                <option value="BACKUP">מחליף</option>
              </select>
            )}
            <StatusBadge
              tone={shift.joinRequestStatus === 'REJECTED' ? 'error' : shift.joinRequestStatus === 'AWAITING_WORKER' ? 'warning' : 'success'}
              label={JOIN_STATUS_LABELS[shift.joinRequestStatus] ?? shift.joinRequestStatus}
            />
          </div>
        )}
        {pendingReplacement && (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              <span
                title={pendingReplacement.reason}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border border-amber-200 bg-amber-50 text-amber-700"
              >
                <Repeat className="w-3 h-3" />
                בקשת החלפה
              </span>
              <button
                onClick={() => void resolveReplacement(pendingReplacement.id, true)}
                disabled={busy}
                title="שחרור העובד/ת ופתיחת העמדה מחדש"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                אישור החלפה
              </button>
              <button
                onClick={() => void resolveReplacement(pendingReplacement.id, false)}
                disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                דחייה
              </button>
            </div>
            {(pendingReplacement.volunteers ?? []).length > 0 && (
              <div className="flex flex-col items-end gap-1 rounded-lg border border-gray-100 bg-gray-50 px-2 py-1.5">
                <span className="text-[10px] text-gray-500">מתנדבים (לפי סדר):</span>
                {(pendingReplacement.volunteers ?? []).map((v, i) => (
                  <div key={v.worker.id} className="flex items-center gap-1.5">
                    <span className="text-[11px] text-gray-800">
                      {i + 1}. {v.worker.firstName} {v.worker.lastName}
                      {(v.worker.skills ?? []).includes(MANAGER_SKILL) && <span className="text-emerald-700"> · ראש צוות</span>}
                    </span>
                    <button
                      onClick={() => void resolveReplacement(pendingReplacement.id, true, v.worker.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md border border-primary-200 text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                    >
                      בחירה
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-gray-500" dir="rtl">טוען…</div>;
  }
  if (!job) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-sm text-gray-500">{error ?? 'העבודה לא נמצאה'}</p>
        <Link href="/jobs" className="text-sm text-primary-600 mt-2 inline-block">חזרה ליומן העבודות</Link>
      </div>
    );
  }

  return (
    <div className="p-6" dir="rtl">
      <Link href={`/cases/${job.caseId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowRight className="w-4 h-4" />
        חזרה לפרוייקט
      </Link>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {JOB_TYPE_LABELS[job.jobType]} · {job.customer.firstName} {job.customer.lastName}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {formatDate(job.date)} · {formatTime(job.plannedStart)}–{formatTime(job.plannedEnd)} ·{' '}
            {job.address?.fullAddress ?? 'כתובת לא זמינה'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jobBadge && <StatusBadge tone={jobBadge.tone} label={jobBadge.label} />}
          {job.status === 'RESERVATION' && (
            <button
              onClick={() => void approveJob()}
              disabled={busy || job.customer.isSystem}
              title={job.customer.isSystem ? 'יש לשייך ללקוח אמיתי לפני אישור' : ''}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              אישור העבודה
            </button>
          )}
          {job.status === 'APPROVED' && (
            <button
              onClick={() => void returnToReservation()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              החזרה לשריון
            </button>
          )}
          {(job.status === 'RESERVATION' || job.status === 'APPROVED') && (
            <button
              onClick={() => void publish()}
              disabled={busy || !readiness?.ready}
              title={readiness?.ready ? '' : 'יש להשלים את תנאי המוכנות'}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              שליחה שוב לעובדים
            </button>
          )}
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
            { key: 'details', label: 'פרטי עבודה' },
            { key: 'staffing', label: 'עובדים' },
            { key: 'attendance', label: 'נוכחות' },
            { key: 'forms', label: 'טפסים' },
            { key: 'notes', label: 'הערות' },
            { key: 'activity', label: 'יומן פעילות' },
          ] as Array<{ key: JobTab; label: string }>
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
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">פרטי העבודה</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="text-gray-500">תאריך</dt><dd className="text-gray-900">{formatDate(job.date)}</dd></div>
              <div><dt className="text-gray-500">שעות</dt><dd className="text-gray-900">{formatTime(job.plannedStart)}–{formatTime(job.plannedEnd)}</dd></div>
              <div><dt className="text-gray-500">כתובת</dt><dd className="text-gray-900">{job.address?.fullAddress ?? '—'}</dd></div>
              <div><dt className="text-gray-500">איש קשר</dt><dd className="text-gray-900">{job.customer.firstName} {job.customer.lastName} · {job.customer.phone}</dd></div>
              <div><dt className="text-gray-500">עובדים נדרשים</dt><dd className="text-gray-900">{job.requiredWorkerCount}</dd></div>
              <div><dt className="text-gray-500">סטטוס</dt><dd className="text-gray-900">{JOB_STATUS_LABELS[job.status] ?? job.status}</dd></div>
            </dl>
          </section>

          {readiness && (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-900">מוכנות לעבודה</h2>
                <StatusBadge tone={readiness.ready ? 'success' : 'warning'} label={readiness.ready ? 'מוכן לפרסום' : 'חסרים תנאים'} />
              </div>
              <ul className="space-y-2">
                {readiness.checks.map((check) => (
                  <li key={check.key} className="flex items-center gap-2 text-sm">
                    {check.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-success" />
                    ) : (
                      <XCircle className="w-4 h-4 text-danger" />
                    )}
                    <span className={check.passed ? 'text-gray-700' : 'text-gray-900 font-medium'}>{check.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Danger zone: archive (keeps records) or permanent delete (spec §15) */}
          <section className="rounded-xl border border-rose-200 bg-rose-50/40 p-5">
            <h2 className="text-sm font-semibold text-rose-900 mb-2">הסרת העבודה</h2>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">סיבה (אופציונלי)</span>
                <select
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm"
                >
                  <option value="">ללא סיבה</option>
                  <option value="הלקוח ביטל">הלקוח ביטל</option>
                  <option value="הלקוח לא הגיב">הלקוח לא הגיב</option>
                  <option value="התאריך השתנה">התאריך השתנה</option>
                  <option value="אין צורך בעבודה">אין צורך בעבודה</option>
                  <option value="נוצר בטעות">נוצר בטעות</option>
                  <option value="אחר">אחר</option>
                </select>
              </label>
              {job.status !== 'ARCHIVED' && (
                <button
                  onClick={() => void archiveJob()}
                  disabled={busy}
                  className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  העברה לארכיון
                </button>
              )}
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.confirm('למחוק לצמיתות את העבודה? לא ניתן לשחזר.')) void deleteJob(deleteReason);
                }}
                disabled={busy}
                className="px-3 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
              >
                מחיקה לצמיתות
              </button>
            </div>
            <p className="mt-2 text-[11px] text-gray-500">מחיקה לצמיתות חסומה לעבודות עם נתוני נוכחות — ניתן להעביר לארכיון בלבד.</p>
          </section>
        </div>
      )}

      {tab === 'staffing' && (
        <div className="space-y-5">
          <div className="flex justify-end">
            <button
              onClick={() => void openMove()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <Repeat className="w-4 h-4" />
              העברת עובדים לעבודה אחרת
            </button>
          </div>
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">ראש צוות</h2>
            {managerSlots.length === 0 ? (
              <p className="text-sm text-gray-400">לא הוגדרה עמדת ראש צוות</p>
            ) : (
              <ul className="space-y-2">
                {managerSlots.map((slot) => {
                  const shift = shiftForSlot(slot.id);
                  return (
                    <li key={slot.id} className="rounded-lg border border-gray-100 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="inline-flex items-center gap-2 text-sm text-gray-800">
                          <UserCheck className="w-4 h-4 text-gray-400" />
                          {shift ? shift.workerNameSnapshot : 'מקום פנוי'}
                        </span>
                        {shift ? (
                          <div className="flex items-center gap-2">
                            {renderShiftStatus(shift)}
                            {shift.attendanceStatus === 'SCHEDULED' && (
                              <button
                                onClick={() => void removeShift(shift.id, shift.workerNameSnapshot)}
                                disabled={busy}
                                aria-label={`הסרת ${shift.workerNameSnapshot}`}
                                className="px-2 py-1 text-[11px] rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              >
                                הסרה
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <StatusBadge tone="warning" label="לא מאויש" />
                            <button
                              onClick={() => void openAssign(slot)}
                              className="px-2.5 py-1 text-[11px] rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50"
                            >
                              שיבוץ
                            </button>
                          </div>
                        )}
                      </div>
                      {!shift && assignSlotId === slot.id && (
                        <div className="mt-2 flex items-center gap-2">
                          <select
                            value={assignWorkerId}
                            onChange={(e) => setAssignWorkerId(e.target.value)}
                            aria-label="בחירת עובד לשיבוץ"
                            className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
                          >
                            <option value="">בחירת עובד…</option>
                            {assignCandidates.map((c) => (
                              <option key={c.id} value={c.id} disabled={!c.available}>
                                {c.name}{c.available ? '' : ' (לא זמין)'}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => void assignWorker()}
                            disabled={busy || !assignWorkerId}
                            className="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                          >
                            אישור
                          </button>
                          <button
                            onClick={() => setAssignSlotId(null)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                          >
                            ביטול
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">עובדים</h2>
            {workerSlots.length === 0 ? (
              <p className="text-sm text-gray-400">לא הוגדרו עמדות עבודה</p>
            ) : (
              <ul className="space-y-2">
                {workerSlots.map((slot) => {
                  const shift = shiftForSlot(slot.id);
                  return (
                    <li key={slot.id} className="rounded-lg border border-gray-100 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-800">{shift ? shift.workerNameSnapshot : 'מקום פנוי'}</span>
                        {shift ? (
                          <div className="flex items-center gap-2">
                            {renderShiftStatus(shift)}
                            {shift.attendanceStatus === 'SCHEDULED' && (
                              <button
                                onClick={() => void removeShift(shift.id, shift.workerNameSnapshot)}
                                disabled={busy}
                                aria-label={`הסרת ${shift.workerNameSnapshot}`}
                                className="px-2 py-1 text-[11px] rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              >
                                הסרה
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <StatusBadge tone="neutral" label="פנוי" />
                            <button
                              onClick={() => void openAssign(slot)}
                              className="px-2.5 py-1 text-[11px] rounded-lg border border-primary-200 text-primary-700 hover:bg-primary-50"
                            >
                              שיבוץ
                            </button>
                          </div>
                        )}
                      </div>
                      {!shift && assignSlotId === slot.id && (
                        <div className="mt-2 flex items-center gap-2">
                          <select
                            value={assignWorkerId}
                            onChange={(e) => setAssignWorkerId(e.target.value)}
                            aria-label="בחירת עובד לשיבוץ"
                            className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
                          >
                            <option value="">בחירת עובד…</option>
                            {assignCandidates.map((c) => (
                              <option key={c.id} value={c.id} disabled={!c.available}>
                                {c.name}{c.available ? '' : ' (לא זמין)'}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => void assignWorker()}
                            disabled={busy || !assignWorkerId}
                            className="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                          >
                            אישור
                          </button>
                          <button
                            onClick={() => setAssignSlotId(null)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                          >
                            ביטול
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'attendance' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">נוכחות</h2>
          {job.shifts.length === 0 ? (
            <p className="text-sm text-gray-400">אין עובדים משובצים לעבודה זו</p>
          ) : (
            <ul className="space-y-2">
              {job.shifts.map((shift) => (
                <li key={shift.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                  <span className="text-sm text-gray-800">{shift.workerNameSnapshot}</span>
                  <span className="text-xs text-gray-500">{ATTENDANCE_LABELS[shift.attendanceStatus] ?? shift.attendanceStatus}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'forms' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">טפסי עובדים</h2>
          {job.shifts.length === 0 ? (
            <p className="text-sm text-gray-400">אין טפסים משויכים</p>
          ) : (
            <ul className="space-y-2">
              {job.shifts.map((shift) => (
                <li key={shift.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                  <span className="text-sm text-gray-800">{shift.workerNameSnapshot}</span>
                  <StatusBadge
                    tone={shift.formStatus === 'SUBMITTED' ? 'success' : shift.formStatus === 'WAIVED' ? 'neutral' : 'warning'}
                    label={shift.formStatus === 'SUBMITTED' ? 'הוגש' : shift.formStatus === 'WAIVED' ? 'לא נדרש' : 'טרם הוגש'}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'notes' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">הערות פנימיות</h3>
            <p className="text-sm text-gray-600">{job.jobNotes || '—'}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">הערות לעובד</h3>
            <p className="text-sm text-gray-600">{job.workerVisibleNotes || '—'}</p>
          </div>
        </section>
      )}

      {tab === 'activity' && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">יומן פעילות</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-gray-400">אין פעילות מתועדת עדיין</p>
          ) : (
            <ul className="space-y-2">
              {activity.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2">
                  <div>
                    <p className="text-sm text-gray-800">{ACTIVITY_LABELS[entry.reason ?? ''] ?? entry.reason ?? entry.action}</p>
                    <p className="text-[11px] text-gray-400">
                      {entry.performedBy ? `${entry.performedBy.firstName} ${entry.performedBy.lastName}` : 'מערכת'}
                      {' · '}
                      {entry.entityType === 'Shift' ? 'עובד' : 'עבודה'}
                    </p>
                  </div>
                  <span className="text-[11px] text-gray-500 whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {moveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-bold text-gray-900 mb-1">העברת עובדים לעבודה אחרת</h2>
            <p className="text-xs text-gray-500 mb-4">ניתן להעביר עובדים רק בין עבודות באותו תאריך.</p>

            {moveTargets.length === 0 ? (
              <p className="text-sm text-gray-500">אין עבודה אחרת בתאריך זה.</p>
            ) : (
              <>
                <label className="block text-sm text-gray-700 mb-1">עבודת יעד</label>
                <select
                  value={moveTargetId}
                  onChange={(e) => setMoveTargetId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-2.5 py-2 text-sm bg-white mb-4"
                >
                  {moveTargets.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>

                <p className="text-sm text-gray-700 mb-2">בחירת עובדים להעברה</p>
                <div className="max-h-56 overflow-auto space-y-1.5 mb-4">
                  {job.shifts.filter((s) => s.joinRequestStatus === 'APPROVED' || s.joinRequestStatus === 'AWAITING_WORKER').length === 0 ? (
                    <p className="text-sm text-gray-400">אין עובדים משובצים להעברה.</p>
                  ) : (
                    job.shifts
                      .filter((s) => s.joinRequestStatus === 'APPROVED' || s.joinRequestStatus === 'AWAITING_WORKER')
                      .map((s) => (
                        <label key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!!moveSelected[s.id]}
                            onChange={(e) => setMoveSelected((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                          />
                          <span className="text-gray-800">{s.workerNameSnapshot}</span>
                          {s.assignmentRole === 'TEAM_LEADER' && <span className="text-[11px] text-emerald-700">· ראש צוות</span>}
                          {s.assignmentRole === 'BACKUP' && <span className="text-[11px] text-amber-700">· מחליף</span>}
                        </label>
                      ))
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMoveOpen(false)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                ביטול
              </button>
              <button
                onClick={() => void submitMove()}
                disabled={busy || !moveTargetId || !Object.values(moveSelected).some(Boolean)}
                className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                העברה
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
