'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ChevronLeft, ChevronRight, Loader2, Plus, Repeat } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';

type ApiJob = {
  id: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: string;
  plannedStart: string;
  plannedEnd: string;
  requiredWorkerCount: number;
  status: 'RESERVATION' | 'APPROVED' | 'COMPLETED' | 'ARCHIVED';
  customer: { firstName: string; lastName: string };
  case: { id: string; name: string } | null;
  shifts: Array<{ workerId: string }>;
};

const JOB_TYPE: Record<ApiJob['jobType'], { label: string; cls: string; dot: string }> = {
  PACKING: { label: 'אריזה', cls: 'bg-red-50 border-red-200 text-red-800', dot: 'bg-red-500' },
  UNPACKING: { label: 'פריקה', cls: 'bg-amber-50 border-amber-200 text-amber-800', dot: 'bg-amber-500' },
  HOME_ORGANIZATION: { label: 'סידור', cls: 'bg-blue-50 border-blue-200 text-blue-800', dot: 'bg-blue-500' },
};

const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function dateKey(d: Date): string {
  return d.toLocaleDateString('en-CA');
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

type OwnerTasks = {
  joinRequests: number;
  pendingAcceptance: number;
  replacementRequests: number;
  swapApprovals: number;
  attendanceReview: number;
  reportCorrections: number;
  customerReportReady: number;
};

function OwnerTasksPanel({ tasks }: { tasks: OwnerTasks }) {
  const items: { key: keyof OwnerTasks; label: string; href?: string }[] = [
    { key: 'joinRequests', label: 'בקשות הצטרפות' },
    { key: 'pendingAcceptance', label: 'ממתין לאישור העובד/ת' },
    { key: 'replacementRequests', label: 'בקשות החלפה' },
    { key: 'swapApprovals', label: 'אישורי החלפת משמרות', href: '/shifts/swaps' },
    { key: 'attendanceReview', label: 'נוכחות לבדיקה', href: '/attendance' },
    { key: 'reportCorrections', label: 'בקשות תיקון דוח', href: '/payroll' },
    { key: 'customerReportReady', label: 'הפרויקט מוכן לדוח לקוחה', href: '/reports/customer' },
  ];
  const active = items.filter((i) => tasks[i.key] > 0);
  if (active.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <h2 className="mb-2 text-sm font-semibold text-amber-900">משימות ממתינות לטיפול</h2>
      <div className="flex flex-wrap gap-2">
        {active.map((i) => {
          const chip = (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800">
              {i.label}
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {tasks[i.key]}
              </span>
            </span>
          );
          return i.href ? (
            <Link key={i.key} href={i.href} className="hover:opacity-80">
              {chip}
            </Link>
          ) : (
            <span key={i.key}>{chip}</span>
          );
        })}
      </div>
    </section>
  );
}

export default function JobsPage() {
  const { getToken } = useAuth();
  const [jobs, setJobs] = useState<ApiJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<OwnerTasks | null>(null);
  const [monthAnchor, setMonthAnchor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<ApiJob[]>('/jobs', auth);
      setJobs(res.data.filter((job) => job.status !== 'ARCHIVED'));
    } catch {
      setError('טעינת יומן העבודות נכשלה');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Aggregated owner action items for the dashboard (integration spec §21).
  useEffect(() => {
    void (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<OwnerTasks>('/admin/tasks', auth);
        setTasks(res.data ?? null);
      } catch {
        setTasks(null);
      }
    })();
  }, [getToken]);

  const jobsByDate = useMemo(() => {
    const map = new Map<string, ApiJob[]>();
    for (const job of jobs) {
      const key = job.date.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(job);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
    }
    return map;
  }, [jobs]);

  const calendarCells = useMemo(() => {
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ key: string; day: number } | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ key: dateKey(new Date(year, month, day)), day });
    }
    return cells;
  }, [monthAnchor]);

  const todayKey = dateKey(new Date());
  const monthLabel = `${MONTHS[monthAnchor.getMonth()]} ${monthAnchor.getFullYear()}`;

  const goMonth = (delta: number) =>
    setMonthAnchor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  return (
    <div dir="rtl" className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">יומן עבודות</h1>
          <p className="text-sm text-gray-600 mt-1">כל העבודות, לפי תאריך וסוג. ניתן ליצור עבודה חדשה לשריון עובדים.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/shifts/swaps"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Repeat className="w-3.5 h-3.5" />
            החלפות משמרות
          </Link>
          <Link
            href="/jobs/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
          >
            <Plus className="w-3.5 h-3.5" />
            עבודה חדשה
          </Link>
        </div>
      </div>

      {tasks && <OwnerTasksPanel tasks={tasks} />}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <button
            type="button"
            onClick={() => goMonth(1)}
            aria-label="החודש הבא"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <h2 className="text-sm font-semibold text-gray-900">{monthLabel}</h2>
          <button
            type="button"
            onClick={() => goMonth(-1)}
            aria-label="החודש הקודם"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>

        {error ? (
          <div className="px-4 py-10 text-center text-sm text-rose-600">{error}</div>
        ) : isLoading ? (
          <div className="flex justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <div className="p-2">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="py-1.5 text-center text-xs font-medium text-gray-400">
                  {wd}
                </div>
              ))}
              {calendarCells.map((cell, index) =>
                cell === null ? (
                  <div key={`blank-${index}`} className="min-h-[92px] rounded-lg" />
                ) : (
                  <div
                    key={cell.key}
                    className={`min-h-[92px] rounded-lg border p-1.5 ${
                      cell.key === todayKey ? 'border-primary-300 bg-primary-50/40' : 'border-gray-100'
                    }`}
                  >
                    <div className="mb-1 text-[11px] font-medium text-gray-400">{cell.day}</div>
                    <div className="space-y-1">
                      {(jobsByDate.get(cell.key) ?? []).map((job) => {
                        const filled = job.shifts.length;
                        const open = Math.max(0, job.requiredWorkerCount - filled);
                        const type = JOB_TYPE[job.jobType];
                        return (
                          <Link
                            key={job.id}
                            href={`/jobs/${job.id}`}
                            className={`block rounded-md border px-1.5 py-1 text-[11px] leading-tight hover:brightness-95 ${type.cls}`}
                          >
                            <div className="flex items-center gap-1 font-medium">
                              <span className={`h-1.5 w-1.5 rounded-full ${type.dot}`} />
                              {type.label} · {formatTime(job.plannedStart)}
                            </div>
                            <div className="truncate opacity-90">
                              {job.customer.firstName} {job.customer.lastName}
                            </div>
                            <div className="mt-0.5 text-[10px] font-medium">
                              {open > 0 ? `${open} מקומות פנויים` : 'מאויש'}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </section>

      {/* Owner shift board: jobs grouped by status with quick filters (spec §18) */}
      {!isLoading && !error && (
        <OwnerShiftBoard jobs={jobs} />
      )}
    </div>
  );
}

const BOARD_STATUS_ORDER = ['RESERVATION', 'APPROVED', 'COMPLETED'] as const;
const BOARD_STATUS_LABELS: Record<string, string> = {
  RESERVATION: 'שריון',
  APPROVED: 'אושר',
  COMPLETED: 'בוצע',
};

type BoardFilter = 'all' | 'reservation' | 'approved' | 'completed' | 'missing' | 'attention';

const BOARD_FILTERS: Array<{ key: BoardFilter; label: string }> = [
  { key: 'all', label: 'הכל' },
  { key: 'reservation', label: 'שריונים' },
  { key: 'approved', label: 'אושרו' },
  { key: 'completed', label: 'בוצעו' },
  { key: 'missing', label: 'חסרים עובדים' },
  { key: 'attention', label: 'דורש טיפול' },
];

function OwnerShiftBoard({ jobs }: { jobs: ApiJob[] }) {
  const [filter, setFilter] = useState<BoardFilter>('all');

  const missingWorkers = (job: ApiJob) => Math.max(0, job.requiredWorkerCount - job.shifts.length) > 0;

  const filtered = useMemo(
    () =>
      jobs.filter((job) => {
        switch (filter) {
          case 'reservation':
            return job.status === 'RESERVATION';
          case 'approved':
            return job.status === 'APPROVED';
          case 'completed':
            return job.status === 'COMPLETED';
          case 'missing':
            return job.status !== 'COMPLETED' && missingWorkers(job);
          case 'attention':
            return (job.status === 'RESERVATION' || job.status === 'APPROVED') && missingWorkers(job);
          default:
            return true;
        }
      }),
    [jobs, filter],
  );

  const groups = useMemo(() => {
    const byStatus: Record<string, ApiJob[]> = { RESERVATION: [], APPROVED: [], COMPLETED: [] };
    for (const job of filtered) {
      (byStatus[job.status] ??= []).push(job);
    }
    for (const key of Object.keys(byStatus)) {
      byStatus[key].sort((a, b) => a.date.localeCompare(b.date));
    }
    return byStatus;
  }, [filtered]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {BOARD_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f.key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {BOARD_STATUS_ORDER.every((s) => groups[s].length === 0) ? (
        <p className="text-sm text-gray-400">אין עבודות להצגה בסינון זה.</p>
      ) : (
        <div className="space-y-4">
          {BOARD_STATUS_ORDER.map((status) =>
            groups[status].length === 0 ? null : (
              <div key={status}>
                <h3 className="mb-2 text-xs font-semibold text-gray-500">
                  {BOARD_STATUS_LABELS[status]} · {groups[status].length}
                </h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {groups[status].map((job) => {
                    const open = Math.max(0, job.requiredWorkerCount - job.shifts.length);
                    const type = JOB_TYPE[job.jobType];
                    return (
                      <Link
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        className={`rounded-lg border p-3 hover:brightness-95 ${type.cls}`}
                      >
                        <div className="flex items-center justify-between gap-1.5 text-sm font-semibold">
                          <span className="flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${type.dot}`} />
                            {type.label}
                          </span>
                          {open > 0 && (
                            <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              חסרים {open}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-sm text-gray-800">
                          {job.customer.firstName} {job.customer.lastName}
                        </div>
                        <div className="text-xs text-gray-500">
                          {new Date(job.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })} ·{' '}
                          {formatTime(job.plannedStart)}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}
