'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, CheckCircle2, RefreshCw, Send, UserCheck, XCircle, Repeat, AlertTriangle, ArrowUpCircle } from 'lucide-react';
import { evaluateJobPublishReadiness, MANAGER_SKILL, deriveJobStatusBadge, auditReasonLabel } from '@workforce/shared';
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
  requiresReview?: boolean;
  formOverdue?: boolean;
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
  address?: { fullAddress: string; latitude?: number | null; longitude?: number | null } | null;
  customer: { firstName: string; lastName: string; phone: string; isSystem?: boolean };
  slots: ApiJobSlot[];
  shifts: ApiJobShift[];
  reportEntry?: { caseId: string; readyForReport: boolean; isLastJob: boolean; finalized?: boolean };
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
// Owner-readable event text is centralized in @workforce/shared (auditReasonLabel).

const JOIN_STATUS_LABELS: Record<string, string> = {
  PENDING: 'ממתין לאישור',
  AWAITING_WORKER: 'ממתין לאישור העובד/ת',
  APPROVED: 'מאושר',
  REJECTED: 'נדחה',
  CANCELLED: 'בוטל',
};

const ATTENDANCE_LABELS: Record<string, string> = {
  SCHEDULED: 'טרם החל',
  PROPOSED: 'הוצע (ממתין לאישור)',
  CLOCKED_IN: 'נכנס',
  CLOCKED_OUT: 'סיים',
  AUTO_CLOCKED_OUT: 'סיים (אוטומטי)',
  CORRECTED: 'תוקן ידנית',
  NO_SHOW: 'לא עבד/ה',
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
  // Owner must explicitly confirm a backup assignment (§12.7): holds the pending
  // approval awaiting confirmation, plus any leader-slot warning to surface.
  const [backupConfirm, setBackupConfirm] = useState<{ shiftId: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Editing the required worker count (§13). Reducing below the number of assigned
  // regular/leader workers opens a backup picker driven by the backend
  // MUST_SELECT_BACKUPS contract (no auto-selection, leader must be preserved).
  const [capacityOpen, setCapacityOpen] = useState(false);
  const [capacityValue, setCapacityValue] = useState('');
  const [capacityPicker, setCapacityPicker] = useState<{ newCount: number; needed: number; candidateIds: string[] } | null>(null);
  const [capacitySelected, setCapacitySelected] = useState<Record<string, boolean>>({});
  // Manual completion resolution (§17.2): the workers still lacking a resolved
  // attendance outcome, plus the owner's per-worker choice.
  const [completeResolve, setCompleteResolve] = useState<Array<{ shiftId: string; workerName: string }> | null>(null);
  const [resolveChoices, setResolveChoices] = useState<Record<string, { outcome: 'WORKED' | 'DID_NOT_WORK'; clockIn?: string; clockOut?: string }>>({});
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
    async (shiftId: string, approved: boolean, confirmBackup = false) => {
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        const res = await api.post<{ assignedRole?: string; warning?: string }>(
          `/shifts/${shiftId}/approve`,
          { approved, confirmBackup },
          auth,
        );
        setBackupConfirm(null);
        if (res.data?.warning) setNotice(res.data.warning);
        else if (res.data?.assignedRole === 'BACKUP') setNotice('העובד/ת שובצה כגיבוי.');
        await load();
      } catch (err) {
        const res = (err as { response?: { data?: { error?: string; message?: string; needsBackupConfirm?: boolean } } })?.response;
        // Approving beyond the required count (or an explicit backup) needs an
        // explicit owner confirmation before assigning the worker as a backup.
        if (approved && res?.data?.needsBackupConfirm) {
          setBackupConfirm({ shiftId, message: res.data.message ?? 'לאשר את העובד/ת כגיבוי?' });
        } else {
          setError(res?.data?.message ?? res?.data?.error ?? 'עדכון בקשת השיבוץ נכשל');
        }
      } finally {
        setBusy(false);
      }
    },
    [getToken, load],
  );

  const promoteBackup = useCallback(async () => {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/shifts/${jobId}/promote-backup`, {}, auth);
      setNotice('גיבוי קודם/ה לעמדה רגילה.');
      await load();
    } catch (err) {
      const res = (err as { response?: { data?: { error?: string; message?: string } } })?.response;
      setError(res?.data?.message ?? res?.data?.error ?? 'קידום הגיבוי נכשל');
    } finally {
      setBusy(false);
    }
  }, [jobId, getToken, load]);

  // §16.5: mark an assigned worker as "Did not work" (a resolved absence).
  const markDidNotWork = useCallback(
    async (shiftId: string) => {
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/attendance/${shiftId}/did-not-work`, {}, auth);
        setNotice('העובד/ת סומנה כלא עבדה.');
        await load();
      } catch (err) {
        const res = (err as { response?: { data?: { error?: string; message?: string } } })?.response;
        setError(res?.data?.message ?? res?.data?.error ?? 'הפעולה נכשלה');
      } finally {
        setBusy(false);
      }
    },
    [getToken, load],
  );

  // §17.2: manually complete the job. If workers lack a resolved outcome the
  // backend responds 409 ATTENDANCE_UNRESOLVED; we open the per-worker resolution
  // screen and resend with the owner's choices.
  const completeJob = useCallback(
    async (
      resolutions?: Array<{ shiftId: string; outcome: 'WORKED' | 'DID_NOT_WORK'; clockIn?: string; clockOut?: string }>,
    ) => {
      if (!jobId) return;
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/jobs/${jobId}/complete`, { resolutions: resolutions ?? [] }, auth);
        setCompleteResolve(null);
        setResolveChoices({});
        setNotice('העבודה סומנה כהושלמה.');
        await load();
      } catch (err) {
        const data = (err as { response?: { data?: { error?: string; message?: string; unresolved?: Array<{ shiftId: string; workerName: string }> } } })?.response?.data;
        if (data?.error === 'ATTENDANCE_UNRESOLVED' && data.unresolved) {
          setCompleteResolve(data.unresolved);
          setResolveChoices(Object.fromEntries(data.unresolved.map((u) => [u.shiftId, { outcome: 'DID_NOT_WORK' as const }])));
        } else {
          setError(data?.message ?? data?.error ?? 'השלמת העבודה נכשלה');
        }
      } finally {
        setBusy(false);
      }
    },
    [jobId, getToken, load],
  );

  // Apply a required-worker-count change. When the count drops below the number of
  // assigned regular/leader workers the backend returns MUST_SELECT_BACKUPS (with
  // the affected shift ids and how many must be demoted); we open the picker and
  // resend with the owner's explicit selection. INVALID_SELECTION means a
  // concurrent change moved the goalposts — refresh and let her re-pick.
  const submitCapacity = useCallback(
    async (newCount: number, demoteToBackupIds: string[] = []) => {
      if (!jobId) return;
      setBusy(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.patch(`/jobs/${jobId}`, { requiredWorkerCount: newCount, demoteToBackupIds }, auth);
        setCapacityOpen(false);
        setCapacityPicker(null);
        setCapacitySelected({});
        setNotice('כמות העובדים עודכנה.');
        await load();
      } catch (err) {
        const data = (err as { response?: { data?: { error?: string; message?: string; needed?: number; regularShiftIds?: string[] } } })
          ?.response?.data;
        if (data?.error === 'MUST_SELECT_BACKUPS' || data?.error === 'INVALID_SELECTION') {
          setCapacityPicker({ newCount, needed: data.needed ?? 0, candidateIds: data.regularShiftIds ?? [] });
          setCapacitySelected({});
          if (data.error === 'INVALID_SELECTION') {
            setError('רשימת העובדים המשובצים השתנתה. יש לבחור מחדש.');
            await load();
          }
        } else {
          // e.g. LEADER_REQUIRED — the only team leader cannot be demoted.
          setError(data?.message ?? data?.error ?? 'עדכון כמות העובדים נכשל');
        }
      } finally {
        setBusy(false);
      }
    },
    [jobId, getToken, load],
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

  // Staffing summary for §12–13 owner controls: missing team leader and whether a
  // backup can be promoted into an open regular position.
  const staffing = useMemo(() => {
    if (!job) return { missingLeader: false, canPromoteBackup: false };
    const active = (s: ApiJobShift) => s.joinRequestStatus === 'APPROVED' || s.joinRequestStatus === 'AWAITING_WORKER';
    const requiresLeader = managerSlots.length > 0;
    const hasLeader = job.shifts.some((s) => active(s) && s.assignmentRole === 'TEAM_LEADER');
    const approvedNormal = job.shifts.filter(
      (s) => s.joinRequestStatus === 'APPROVED' && (s.assignmentRole === 'REGULAR' || s.assignmentRole === 'TEAM_LEADER'),
    ).length;
    const hasBackup = job.shifts.some((s) => s.joinRequestStatus === 'APPROVED' && s.assignmentRole === 'BACKUP');
    return {
      missingLeader: requiresLeader && !hasLeader,
      canPromoteBackup: hasBackup && approvedNormal < job.requiredWorkerCount,
    };
  }, [job, managerSlots]);

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
                <option value="BACKUP">גיבוי</option>
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
      <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowRight className="w-4 h-4" />
        חזרה ליומן העבודות
      </Link>

      {job.reportEntry?.readyForReport && job.reportEntry.isLastJob && (
        <Link
          href={`/cases/${job.reportEntry.caseId}/customer-report`}
          className="mb-4 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800 hover:border-green-300"
        >
          <span className="font-medium">הפרויקט מוכן — יצירת דוח לקוחה</span>
          <ArrowRight className="w-4 h-4 rotate-180" />
        </Link>
      )}

      {job.reportEntry?.finalized && (
        <Link
          href={`/cases/${job.reportEntry.caseId}/customer-report`}
          className="mb-4 flex items-center justify-between rounded-lg border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm text-primary-800 hover:border-primary-300"
        >
          <span className="font-medium">דוח הלקוחה הופק — צפייה, היסטוריית גרסאות והורדת PDF</span>
          <ArrowRight className="w-4 h-4 rotate-180" />
        </Link>
      )}

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
      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm px-4 py-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-600 hover:text-amber-800" aria-label="סגירה">✕</button>
        </div>
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
              <div>
                <dt className="text-gray-500">עובדים נדרשים</dt>
                <dd className="text-gray-900">
                  {capacityOpen ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        value={capacityValue}
                        onChange={(e) => setCapacityValue(e.target.value)}
                        aria-label="כמות עובדים נדרשת"
                        className="w-16 rounded-lg border border-gray-300 px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => {
                          const n = Math.max(1, Math.floor(Number(capacityValue) || 0));
                          if (n && n !== job.requiredWorkerCount) void submitCapacity(n);
                          else setCapacityOpen(false);
                        }}
                        disabled={busy}
                        className="px-2 py-1 text-[11px] rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                      >
                        שמירה
                      </button>
                      <button
                        onClick={() => setCapacityOpen(false)}
                        className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                      >
                        ביטול
                      </button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {job.requiredWorkerCount}
                      <button
                        onClick={() => {
                          setCapacityValue(String(job.requiredWorkerCount));
                          setCapacityOpen(true);
                        }}
                        className="text-[11px] text-primary-700 hover:underline"
                      >
                        עריכה
                      </button>
                    </span>
                  )}
                </dd>
              </div>
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
          {(staffing.missingLeader || staffing.canPromoteBackup) && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {staffing.missingLeader && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    חסר ראש צוות
                  </span>
                )}
                {staffing.canPromoteBackup && (
                  <span className="text-[12px] text-amber-800">יש עמדה פנויה שניתן לאייש מרשימת הגיבוי.</span>
                )}
              </div>
              {staffing.canPromoteBackup && (
                <button
                  onClick={() => void promoteBackup()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  קידום גיבוי לעמדה פנויה
                </button>
              )}
            </div>
          )}
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">נוכחות</h2>
            {job.status !== 'COMPLETED' && job.status !== 'ARCHIVED' && (
              <button
                onClick={() => void completeJob()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                סימון כהושלם
              </button>
            )}
          </div>
          {job.address && (job.address.latitude == null || job.address.longitude == null) && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                לכתובת העבודה אין קואורדינטות — ניטור מיקום (כניסה/יציאה מהאזור) אינו פעיל למשמרת זו. הנוכחות אינה מוגנת ע״י כלל 500 מ׳ ותיבדק ידנית לפי הצורך.
              </span>
            </div>
          )}
          {job.shifts.length === 0 ? (
            <p className="text-sm text-gray-400">אין עובדים משובצים לעבודה זו</p>
          ) : (
            <ul className="space-y-2">
              {job.shifts
                .filter((s) => s.joinRequestStatus === 'APPROVED')
                .map((shift) => {
                  const resolvable =
                    shift.assignmentRole !== 'BACKUP' &&
                    (shift.attendanceStatus === 'SCHEDULED' || shift.attendanceStatus === 'PROPOSED');
                  return (
                    <li key={shift.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                      <span className="text-sm text-gray-800">
                        {shift.workerNameSnapshot}
                        {shift.assignmentRole === 'BACKUP' && <span className="text-[11px] text-amber-700"> · גיבוי</span>}
                        {shift.assignmentRole === 'TEAM_LEADER' && <span className="text-[11px] text-emerald-700"> · ראש צוות</span>}
                      </span>
                      <div className="flex items-center gap-2">
                        {shift.requiresReview && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                            <AlertTriangle className="w-3 h-3" />
                            לבדיקה
                          </span>
                        )}
                        <span className="text-xs text-gray-500">{ATTENDANCE_LABELS[shift.attendanceStatus] ?? shift.attendanceStatus}</span>
                        {resolvable && (
                          <button
                            onClick={() => void markDidNotWork(shift.id)}
                            disabled={busy}
                            className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                          >
                            לא עבד/ה
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
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
                    <p className="text-sm text-gray-800">{auditReasonLabel(entry.reason)}</p>
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

      {backupConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-bold text-gray-900 mb-2">שיבוץ כגיבוי</h2>
            <p className="text-sm text-gray-600 mb-5">{backupConfirm.message}</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setBackupConfirm(null)}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                ביטול
              </button>
              <button
                onClick={() => void decideJoinRequest(backupConfirm.shiftId, true, true)}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                שיבוץ כגיבוי
              </button>
            </div>
          </div>
        </div>
      )}

      {capacityPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-bold text-gray-900 mb-1">בחירת עובדים לגיבוי</h2>
            <p className="text-xs text-gray-500 mb-4">
              כמות העובדים הופחתה. יש לבחור {capacityPicker.needed} עובדות שיעברו לתפקיד גיבוי — הן יישארו משובצות אך כגיבוי. ראש צוות חייב להישאר משובץ.
            </p>
            <div className="max-h-64 overflow-auto space-y-1.5 mb-3">
              {job.shifts
                .filter((s) => capacityPicker.candidateIds.includes(s.id))
                .map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!capacitySelected[s.id]}
                      onChange={(e) => setCapacitySelected((prev) => ({ ...prev, [s.id]: e.target.checked }))}
                    />
                    <span className="text-gray-800">{s.workerNameSnapshot}</span>
                    {s.assignmentRole === 'TEAM_LEADER' && <span className="text-[11px] text-emerald-700">· ראש צוות</span>}
                  </label>
                ))}
            </div>
            <p className="text-[11px] text-gray-500 mb-3">
              נבחרו {Object.values(capacitySelected).filter(Boolean).length} מתוך {capacityPicker.needed}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setCapacityPicker(null);
                  setCapacitySelected({});
                }}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                ביטול
              </button>
              <button
                onClick={() =>
                  void submitCapacity(
                    capacityPicker.newCount,
                    Object.keys(capacitySelected).filter((k) => capacitySelected[k]),
                  )
                }
                disabled={busy || Object.values(capacitySelected).filter(Boolean).length !== capacityPicker.needed}
                className="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                עדכון והעברה לגיבוי
              </button>
            </div>
          </div>
        </div>
      )}

      {completeResolve && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-bold text-gray-900 mb-1">השלמת עבודה — סיכום נוכחות</h2>
            <p className="text-xs text-gray-500 mb-4">יש לקבוע לכל עובד/ת: עבד/ה (עם שעות) או לא עבד/ה.</p>
            <div className="max-h-72 overflow-auto space-y-3 mb-4">
              {completeResolve.map((u) => {
                const choice = resolveChoices[u.shiftId] ?? { outcome: 'DID_NOT_WORK' as const };
                return (
                  <div key={u.shiftId} className="rounded-lg border border-gray-100 p-3">
                    <div className="text-sm font-medium text-gray-800 mb-2">{u.workerName}</div>
                    <div className="flex items-center gap-4 mb-2 text-sm">
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={`o-${u.shiftId}`}
                          checked={choice.outcome === 'DID_NOT_WORK'}
                          onChange={() => setResolveChoices((p) => ({ ...p, [u.shiftId]: { outcome: 'DID_NOT_WORK' } }))}
                        />
                        לא עבד/ה
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="radio"
                          name={`o-${u.shiftId}`}
                          checked={choice.outcome === 'WORKED'}
                          onChange={() => setResolveChoices((p) => ({ ...p, [u.shiftId]: { outcome: 'WORKED', clockIn: p[u.shiftId]?.clockIn, clockOut: p[u.shiftId]?.clockOut } }))}
                        />
                        עבד/ה
                      </label>
                    </div>
                    {choice.outcome === 'WORKED' && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <label className="text-gray-500">כניסה</label>
                        <input
                          type="datetime-local"
                          value={choice.clockIn ?? ''}
                          onChange={(e) => setResolveChoices((p) => ({ ...p, [u.shiftId]: { ...(p[u.shiftId] ?? { outcome: 'WORKED' }), outcome: 'WORKED', clockIn: e.target.value } }))}
                          className="rounded border border-gray-300 px-2 py-1"
                        />
                        <label className="text-gray-500">יציאה</label>
                        <input
                          type="datetime-local"
                          value={choice.clockOut ?? ''}
                          onChange={(e) => setResolveChoices((p) => ({ ...p, [u.shiftId]: { ...(p[u.shiftId] ?? { outcome: 'WORKED' }), outcome: 'WORKED', clockOut: e.target.value } }))}
                          className="rounded border border-gray-300 px-2 py-1"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setCompleteResolve(null); setResolveChoices({}); }}
                className="px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                ביטול
              </button>
              <button
                onClick={() => {
                  const resolutions = completeResolve.map((u) => {
                    const c = resolveChoices[u.shiftId] ?? { outcome: 'DID_NOT_WORK' as const };
                    if (c.outcome === 'WORKED') {
                      return {
                        shiftId: u.shiftId,
                        outcome: 'WORKED' as const,
                        clockIn: c.clockIn ? new Date(c.clockIn).toISOString() : undefined,
                        clockOut: c.clockOut ? new Date(c.clockOut).toISOString() : undefined,
                      };
                    }
                    return { shiftId: u.shiftId, outcome: 'DID_NOT_WORK' as const };
                  });
                  const missingTimes = resolutions.some((r) => r.outcome === 'WORKED' && (!r.clockIn || !r.clockOut));
                  if (missingTimes) { setError('יש להזין שעות כניסה ויציאה לכל עובד/ת שעבד/ה.'); return; }
                  void completeJob(resolutions);
                }}
                disabled={busy}
                className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                אישור והשלמה
              </button>
            </div>
          </div>
        </div>
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
                          {s.assignmentRole === 'BACKUP' && <span className="text-[11px] text-amber-700">· גיבוי</span>}
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
