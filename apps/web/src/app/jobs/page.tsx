'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Repeat } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';

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
  PACKING: {
    label: 'אריזה',
    cls: 'border-[var(--color-calendar-aubergine-border)] bg-[var(--color-calendar-aubergine-soft)] text-[var(--color-calendar-aubergine)]',
    dot: 'bg-[var(--color-calendar-aubergine)]',
  },
  UNPACKING: {
    label: 'פריקה',
    cls: 'border-[var(--color-calendar-sand-border)] bg-[var(--color-calendar-sand-soft)] text-[var(--color-calendar-sand)]',
    dot: 'bg-[var(--color-calendar-sand)]',
  },
  HOME_ORGANIZATION: {
    label: 'סידור',
    cls: 'border-[var(--color-calendar-sage-border)] bg-[var(--color-calendar-sage-soft)] text-[var(--color-calendar-sage)]',
    dot: 'bg-[var(--color-calendar-sage)]',
  },
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
    <div dir="rtl" className="space-y-6">
      <PageHeader
        eyebrow="THE MONTH, BEAUTIFULLY ARRANGED"
        title="העבודות שבדרך"
        description="תכנון חודשי ברור של הלקוחות, הצוות וכל מה שדורש תשומת לב."
        icon={<CalendarDays className="h-6 w-6" />}
        action={
          <div className="flex items-center gap-2">
          <Link
            href="/shifts/swaps"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-[var(--color-surface-muted)]"
          >
            <Repeat className="h-4 w-4" />
            החלפות משמרות
          </Link>
          <Link
            href="/jobs/new"
            className="inline-flex min-h-11 items-center gap-2 bg-[var(--color-calendar-sage)] px-5 py-2.5 text-sm font-medium text-[var(--color-background)] hover:bg-primary-700"
          >
            <span aria-hidden="true">＋</span>
            עבודה חדשה
          </Link>
          </div>
        }
      />

      <section className="overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-4">
          <button
            type="button"
            onClick={() => goMonth(1)}
            aria-label="החודש הבא"
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <h2 className="font-display text-2xl font-medium text-gray-900">{monthLabel}</h2>
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
                    className={`min-h-[100px] border p-1.5 ${
                      cell.key === todayKey
                        ? 'border-[var(--color-calendar-sage-border)] bg-[var(--color-calendar-sage-soft)] shadow-[inset_0_2px_0_var(--color-calendar-sage)]'
                        : 'border-[var(--color-border)]'
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
                            className={`block border-r-2 bg-transparent px-1.5 py-1 text-[11px] leading-tight hover:bg-[var(--color-surface)] ${type.cls}`}
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
    <section className="border-y border-[var(--color-border)] py-5">
      <div className="mb-5 flex max-w-full gap-5 overflow-x-auto border-b border-[var(--color-border)]">
        {BOARD_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`min-h-10 shrink-0 border-b-2 px-1 py-2 text-xs font-medium ${
              filter === f.key ? 'border-primary-700 text-primary-800' : 'border-transparent text-gray-600'
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
                <div className="divide-y divide-[var(--color-border)]">
                  {groups[status].map((job) => {
                    const open = Math.max(0, job.requiredWorkerCount - job.shifts.length);
                    const type = JOB_TYPE[job.jobType];
                    return (
                      <Link
                        key={job.id}
                        href={`/jobs/${job.id}`}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-2 py-4 hover:bg-primary-50/40"
                      >
                        <div>
                          <div className="flex items-center gap-1.5 text-sm font-semibold">
                            <span className={`h-2 w-2 rounded-full ${type.dot}`} />
                            {type.label}
                          </div>
                          <div className="mt-1 text-sm text-gray-800">
                            {job.customer.firstName} {job.customer.lastName}
                          </div>
                        </div>
                        <div className="text-left">
                          <div className="text-xs text-gray-500">
                            {new Date(job.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })} ·{' '}
                            {formatTime(job.plannedStart)}
                          </div>
                          {open > 0 && (
                            <span className="mt-1 inline-block text-[10px] font-medium text-amber-700">
                              חסרים {open}
                            </span>
                          )}
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
