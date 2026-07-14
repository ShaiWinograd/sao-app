'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, CheckCircle2, RefreshCw, Send, UserCheck, XCircle } from 'lucide-react';
import { evaluateJobPublishReadiness, MANAGER_SKILL } from '@workforce/shared';
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
  formStatus: string;
  worker?: { firstName: string; lastName: string } | null;
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
  customer: { firstName: string; lastName: string; phone: string };
  slots: ApiJobSlot[];
  shifts: ApiJobShift[];
};

type JobTab = 'details' | 'staffing' | 'attendance' | 'forms' | 'notes';

const JOB_TYPE_LABELS: Record<ApiJobDetail['jobType'], string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

const JOB_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'טיוטה',
  PUBLISHED: 'פורסמה',
  IN_PROGRESS: 'בביצוע',
  COMPLETED: 'הושלמה',
  CANCELLED: 'בוטלה',
};

const JOIN_STATUS_LABELS: Record<string, string> = {
  PENDING: 'ממתין לאישור',
  APPROVED: 'מאושר',
  REJECTED: 'נדחה',
  WAITLISTED: 'רשימת המתנה',
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

  const renderShiftStatus = (shift: ApiJobShift) => {
    if (shift.joinRequestStatus === 'PENDING') {
      return (
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
      );
    }
    return (
      <StatusBadge
        tone={shift.joinRequestStatus === 'REJECTED' ? 'error' : 'success'}
        label={JOIN_STATUS_LABELS[shift.joinRequestStatus] ?? shift.joinRequestStatus}
      />
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
          <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
            {JOB_STATUS_LABELS[job.status] ?? job.status}
          </span>
          {job.status === 'DRAFT' && (
            <button
              onClick={() => void publish()}
              disabled={busy || !readiness?.ready}
              title={readiness?.ready ? '' : 'יש להשלים את תנאי המוכנות'}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              פרסום העבודה
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
        </div>
      )}

      {tab === 'staffing' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">מנהל עבודה</h2>
            {managerSlots.length === 0 ? (
              <p className="text-sm text-gray-400">לא הוגדרה עמדת מנהל עבודה</p>
            ) : (
              <ul className="space-y-2">
                {managerSlots.map((slot) => {
                  const shift = shiftForSlot(slot.id);
                  return (
                    <li key={slot.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                      <span className="inline-flex items-center gap-2 text-sm text-gray-800">
                        <UserCheck className="w-4 h-4 text-gray-400" />
                        {shift ? shift.workerNameSnapshot : 'מקום פנוי'}
                      </span>
                      {shift ? (
                        renderShiftStatus(shift)
                      ) : (
                        <StatusBadge tone="warning" label="לא מאויש" />
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
                    <li key={slot.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                      <span className="text-sm text-gray-800">{shift ? shift.workerNameSnapshot : 'מקום פנוי'}</span>
                      {shift ? (
                        renderShiftStatus(shift)
                      ) : (
                        <StatusBadge tone="neutral" label="פנוי" />
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
    </div>
  );
}
