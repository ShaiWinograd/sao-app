'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';

type ApiJob = {
  id: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: string;
  plannedStart: string;
  plannedEnd: string;
  requiredWorkerCount: number;
  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  customer: { firstName: string; lastName: string };
  case: { id: string; name: string } | null;
  shifts: Array<{ workerId: string }>;
};

const JOB_TYPE: Record<ApiJob['jobType'], { label: string; cls: string; dot: string }> = {
  PACKING: { label: 'אריזה', cls: 'bg-blue-50 border-blue-200 text-blue-800', dot: 'bg-blue-500' },
  UNPACKING: { label: 'פריקה', cls: 'bg-amber-50 border-amber-200 text-amber-800', dot: 'bg-amber-500' },
  HOME_ORGANIZATION: { label: 'סידור', cls: 'bg-purple-50 border-purple-200 text-purple-800', dot: 'bg-purple-500' },
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

export default function JobsPage() {
  const { getToken } = useAuth();
  const [jobs, setJobs] = useState<ApiJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      setJobs(res.data.filter((job) => job.status !== 'CANCELLED'));
    } catch {
      setError('טעינת יומן העבודות נכשלה');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

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
          <p className="text-sm text-gray-600 mt-1">כל העבודות המתוזמנות, לפי תאריך וסוג. עבודות נוצרות מתוך פרויקט.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/cases/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
          >
            <Plus className="w-3.5 h-3.5" />
            פרויקט חדש
          </Link>
        </div>
      </div>

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

      {/* Open-staffing summary: jobs that still need workers */}
      {!isLoading && !error && (
        <OpenStaffingList jobs={jobs} />
      )}
    </div>
  );
}

function OpenStaffingList({ jobs }: { jobs: ApiJob[] }) {
  const openJobs = useMemo(
    () =>
      jobs
        .filter((job) => Math.max(0, job.requiredWorkerCount - job.shifts.length) > 0)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [jobs],
  );

  if (openJobs.length === 0) return null;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">עבודות עם מקומות פנויים</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {openJobs.map((job) => {
          const open = Math.max(0, job.requiredWorkerCount - job.shifts.length);
          const type = JOB_TYPE[job.jobType];
          return (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className={`rounded-lg border p-3 hover:brightness-95 ${type.cls}`}
            >
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                <span className={`h-2 w-2 rounded-full ${type.dot}`} />
                {type.label}
              </div>
              <div className="mt-1 text-sm text-gray-800">{job.customer.firstName} {job.customer.lastName}</div>
              <div className="text-xs text-gray-500">
                {new Date(job.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })} · {formatTime(job.plannedStart)}
              </div>
              <div className="mt-1.5 inline-flex items-center rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
                {open} מקומות פנויים
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
