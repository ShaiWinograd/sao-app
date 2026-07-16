'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { MapPin, Clock, Users, Star, Repeat } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import { isUnavailableOn, type AvailabilityBlock } from '@workforce/shared';
import {
  type WorkerJob,
  type WorkerShift,
  jobTypeLabel,
  jobTypeClasses,
  formatDate,
  formatTime,
  customerName,
  openPositions,
  dateKey,
} from '../../../lib/worker';

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
};

export default function OpenJobsPage() {
  const { getToken } = useAuth();
  const [jobs, setJobs] = useState<WorkerJob[]>([]);
  const [shifts, setShifts] = useState<WorkerShift[]>([]);
  const [availability, setAvailability] = useState<AvailabilityBlock[]>([]);
  const [replacements, setReplacements] = useState<OpenReplacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [busyReq, setBusyReq] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const [jobsRes, shiftsRes] = await Promise.all([
        api.get<WorkerJob[]>('/jobs?status=PUBLISHED', auth),
        api.get<WorkerShift[]>('/shifts/mine', auth),
      ]);
      setJobs(jobsRes.data ?? []);
      setShifts(shiftsRes.data ?? []);
    } catch {
      setJobs([]);
      setShifts([]);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Availability blocks the worker set (unavailable dates). Non-fatal if missing.
  useEffect(() => {
    void (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<AvailabilityBlock[]>('/workers/me/availability', auth);
        setAvailability(res.data ?? []);
      } catch {
        setAvailability([]);
      }
    })();
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
    void loadReplacements();
  }, [loadReplacements]);

  const volunteer = useCallback(
    async (requestId: string, has: boolean) => {
      setBusyReq(requestId);
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
        setBusyReq(null);
      }
    },
    [getToken, loadReplacements],
  );

  // Dates the worker is already approved on (blocks joining another job that day).
  const approvedDates = useMemo(
    () => new Set(shifts.filter((s) => s.joinRequestStatus === 'APPROVED').map((s) => dateKey(s.scheduledStart))),
    [shifts],
  );
  // Current join state per job for this worker.
  const myStatusByJob = useMemo(() => {
    const map = new Map<string, string>();
    shifts.forEach((s) => {
      if (s.joinRequestStatus === 'APPROVED' || s.joinRequestStatus === 'PENDING' || s.joinRequestStatus === 'WAITLISTED') {
        map.set(s.jobId, s.joinRequestStatus);
      }
    });
    return map;
  }, [shifts]);

  const todayKey = dateKey(new Date().toISOString());
  const visibleJobs = useMemo(
    () => jobs.filter((j) => dateKey(j.date) >= todayKey).sort((a, b) => a.date.localeCompare(b.date)),
    [jobs, todayKey],
  );

  const join = useCallback(
    async (jobId: string) => {
      setBusyJobId(jobId);
      setMessage(null);
      try {
        const auth = await authHeaders(getToken);
        const res = await api.post<{ autoApproved: boolean }>('/shifts/join-request', { jobId }, auth);
        setMessage(res.data.autoApproved ? 'שובצת לעבודה! מופיעה ביומן שלך.' : 'הבקשה נשלחה וממתינה לאישור.');
        await load();
      } catch (err) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setMessage(
          status === 409
            ? 'כבר שובצת לעבודה אחרת בתאריך זה.'
            : 'לא ניתן היה לשלוח את הבקשה. נסי שוב.',
        );
      } finally {
        setBusyJobId(null);
      }
    },
    [getToken, load],
  );

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">עבודות פתוחות</h1>
        <p className="text-sm text-gray-500 mt-0.5">כל העבודות שפורסמו. אפשר להצטרף לעבודות עם מקומות פנויים.</p>
      </div>

      {message && (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-800">{message}</div>
      )}

      {/* Open replacement requests to volunteer for */}
      {replacements.length > 0 && (
        <section>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-2">
            <Repeat className="w-4 h-4 text-amber-500" />
            משמרות שדורשות החלפה
          </h2>
          <div className="space-y-2">
            {replacements.map((r) => (
              <div key={r.requestId} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${jobTypeClasses(r.jobType)}`}>
                    {jobTypeLabel(r.jobType)}
                  </span>
                  <span className="text-xs font-semibold text-gray-900">{formatDate(r.date)}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-gray-900">{r.customerName}</p>
                {r.address && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
                    <MapPin className="w-3.5 h-3.5 shrink-0" />
                    {r.address}
                  </p>
                )}
                <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                  <Clock className="w-3.5 h-3.5" />
                  {formatTime(r.plannedStart)}–{formatTime(r.plannedEnd)}
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">{r.volunteerCount} מתנדבים</span>
                  <button
                    type="button"
                    onClick={() => void volunteer(r.requestId, r.hasVolunteered)}
                    disabled={busyReq === r.requestId}
                    className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                      r.hasVolunteered
                        ? 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        : 'bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                  >
                    {busyReq === r.requestId ? '…' : r.hasVolunteered ? 'ביטול התנדבות' : 'התנדבות למשמרת'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {visibleJobs.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">אין כרגע עבודות פתוחות.</p>
      ) : (
        <div className="space-y-3">
          {visibleJobs.map((job) => {
            const open = openPositions(job);
            const myStatus = myStatusByJob.get(job.id);
            const needsLead = (job.slots ?? []).some((s) => s.requiredSkill === 'SHIFT_LEADER');
            const conflict = approvedDates.has(dateKey(job.date)) && !myStatus;
            const blocked = !myStatus && isUnavailableOn(availability, dateKey(job.date));
            const isFull = open === 0 && !myStatus;
            const assigned = (job.shifts ?? []).filter(
              (s) => s.joinRequestStatus === 'APPROVED' || s.joinRequestStatus === 'PENDING',
            ).length;

            return (
              <div key={job.id} className="rounded-xl border border-gray-200 bg-white p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${jobTypeClasses(job.jobType)}`}>
                    {jobTypeLabel(job.jobType)}
                  </span>
                  <span className="text-xs font-semibold text-gray-900">{formatDate(job.date)}</span>
                </div>

                <p className="mt-2 text-sm font-semibold text-gray-900">{customerName(job.customer)}</p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  {job.address?.fullAddress ?? 'כתובת תתעדכן'}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatTime(job.plannedStart)}–{formatTime(job.plannedEnd)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {assigned}/{job.requiredWorkerCount} משובצות
                  </span>
                  {needsLead && (
                    <span className="flex items-center gap-1 text-emerald-700">
                      <Star className="w-3.5 h-3.5" />
                      דרוש/ה ראש צוות
                    </span>
                  )}
                </div>

                {job.workerVisibleNotes && (
                  <p className="mt-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-xs text-gray-600">{job.workerVisibleNotes}</p>
                )}

                <div className="mt-3">
                  {myStatus === 'APPROVED' ? (
                    <span className="inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
                      שובצת לעבודה זו
                    </span>
                  ) : myStatus ? (
                    <span className="inline-flex rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">
                      {myStatus === 'WAITLISTED' ? 'ברשימת המתנה' : 'ממתין לאישור'}
                    </span>
                  ) : conflict ? (
                    <p className="text-xs text-rose-600">לא ניתן להצטרף – כבר שובצת לעבודה אחרת בתאריך זה</p>
                  ) : blocked ? (
                    <p className="text-xs text-rose-600">סימנת שאינך זמינה בתאריך זה</p>
                  ) : isFull ? (
                    <span className="inline-flex rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-500">
                      העבודה מלאה
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void join(job.id)}
                      disabled={busyJobId === job.id}
                      className="inline-flex items-center rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {busyJobId === job.id ? 'שולח…' : 'הצטרפות לעבודה'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
