'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { formatJobTime } from '@workforce/shared';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Repeat } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { SidePanel } from '../../components/ui/SidePanel';
import { OwnerJobDetail } from '../../components/jobs/OwnerJobDetail';
import { StaffingStateSummary, getStaffingStateSummary } from '../../components/jobs/StaffingStateSummary';

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
  shifts: Array<{
    workerId: string;
    workerNameSnapshot?: string | null;
    joinRequestStatus?: string | null;
    assignmentRole?: string | null;
    worker?: { firstName?: string | null; lastName?: string | null } | null;
  }>;
};

const JOB_TYPE: Record<ApiJob['jobType'], { label: string; cls: string; dot: string }> = {
  PACKING: {
    label: 'אריזה',
    cls: 'border-red-200 bg-red-50 text-red-800',
    dot: 'bg-red-500',
  },
  UNPACKING: {
    label: 'פריקה',
    cls: 'border-amber-200 bg-amber-50 text-amber-800',
    dot: 'bg-amber-500',
  },
  HOME_ORGANIZATION: {
    label: 'סידור',
    cls: 'border-blue-200 bg-blue-50 text-blue-800',
    dot: 'bg-blue-500',
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
  return formatJobTime(iso);
}

export default function JobsPage() {
  const router = useRouter();
  const { getToken } = useAuth();
  const [jobs, setJobs] = useState<ApiJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
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
                    role={cell.key >= todayKey ? 'button' : undefined}
                    tabIndex={cell.key >= todayKey ? 0 : undefined}
                    onClick={() => {
                      if (cell.key >= todayKey) router.push(`/jobs/new?date=${cell.key}`);
                    }}
                    onKeyDown={(event) => {
                      if (cell.key >= todayKey && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        router.push(`/jobs/new?date=${cell.key}`);
                      }
                    }}
                    aria-label={cell.key >= todayKey ? `יצירת עבודה בתאריך ${cell.key}` : undefined}
                    className={`min-h-[100px] border p-1.5 ${
                      cell.key === todayKey
                        ? 'border-[var(--color-calendar-sage-border)] bg-[var(--color-calendar-sage-soft)] shadow-[inset_0_2px_0_var(--color-calendar-sage)]'
                        : 'border-[var(--color-border)]'
                    } ${cell.key >= todayKey ? 'cursor-pointer hover:border-[var(--color-calendar-sage-border)]' : ''}`}
                  >
                    <div className="mb-1 text-[11px] font-medium text-gray-400">{cell.day}</div>
                    <div className="space-y-1">
                      {(jobsByDate.get(cell.key) ?? []).map((job) => {
                        const summaryShifts = job.shifts.map((shift) => ({
                          ...shift,
                          workerNameSnapshot:
                            shift.workerNameSnapshot ??
                            `${shift.worker?.firstName ?? ''} ${shift.worker?.lastName ?? ''}`.trim(),
                        }));
                        const staffing = getStaffingStateSummary(summaryShifts, job.requiredWorkerCount);
                        const type = JOB_TYPE[job.jobType];
                        return (
                          <div
                            key={job.id}
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                            className={`w-full border-r-2 bg-transparent px-1.5 py-1 text-right text-[11px] leading-tight ${type.cls}`}
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedJobId(job.id)}
                              className="block w-full text-right hover:bg-[var(--color-surface)]"
                            >
                              <span className="flex items-center gap-1 font-medium">
                                <span className={`h-1.5 w-1.5 rounded-full ${type.dot}`} />
                                {type.label} · {formatTime(job.plannedStart)}
                              </span>
                              <span className="block truncate opacity-90">
                                {job.customer.firstName} {job.customer.lastName}
                              </span>
                              <span className="mt-0.5 block text-[10px] font-medium">
                                {staffing.approvedNames.length}/{job.requiredWorkerCount} משובצים
                                {' · '}
                                {staffing.openSlots > 0 ? `${staffing.openSlots} פתוחים` : 'מאויש'}
                              </span>
                            </button>
                            <StaffingStateSummary
                              shifts={summaryShifts}
                              requiredWorkerCount={job.requiredWorkerCount}
                              className="mt-1"
                            />
                          </div>
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
        <OwnerShiftBoard jobs={jobs} onSelectJob={setSelectedJobId} />
      )}
      <SidePanel
        open={Boolean(selectedJobId)}
        onClose={() => setSelectedJobId(null)}
        title="פרטי עבודה"
        widthClassName="sm:max-w-2xl xl:max-w-3xl"
      >
        {selectedJobId && <OwnerJobDetail jobId={selectedJobId} embedded />}
      </SidePanel>
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

function OwnerShiftBoard({ jobs, onSelectJob }: { jobs: ApiJob[]; onSelectJob: (jobId: string) => void }) {
  const [filter, setFilter] = useState<BoardFilter>('all');

  const staffingFor = (job: ApiJob) =>
    getStaffingStateSummary(
      job.shifts.map((shift) => ({
        ...shift,
        workerNameSnapshot:
          shift.workerNameSnapshot ??
          `${shift.worker?.firstName ?? ''} ${shift.worker?.lastName ?? ''}`.trim(),
      })),
      job.requiredWorkerCount,
    );
  const missingWorkers = (job: ApiJob) => staffingFor(job).openSlots > 0;

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
                    const summaryShifts = job.shifts.map((shift) => ({
                      ...shift,
                      workerNameSnapshot:
                        shift.workerNameSnapshot ??
                        `${shift.worker?.firstName ?? ''} ${shift.worker?.lastName ?? ''}`.trim(),
                    }));
                    const staffing = getStaffingStateSummary(summaryShifts, job.requiredWorkerCount);
                    const type = JOB_TYPE[job.jobType];
                    return (
                      <div
                        key={job.id}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 px-2 py-4 text-right hover:bg-primary-50/40"
                      >
                        <button type="button" onClick={() => onSelectJob(job.id)} className="text-right">
                          <div className="flex items-center gap-1.5 text-sm font-semibold">
                            <span className={`h-2 w-2 rounded-full ${type.dot}`} />
                            {type.label}
                          </div>
                          <div className="mt-1 text-sm text-gray-800">
                            {job.customer.firstName} {job.customer.lastName}
                          </div>
                        </button>
                        <div className="text-left">
                          <div className="text-xs text-gray-500">
                            {new Date(job.date).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })} ·{' '}
                            {formatTime(job.plannedStart)}
                          </div>
                          <span className="mt-1 inline-block text-[10px] font-medium text-amber-700">
                            {staffing.approvedNames.length}/{job.requiredWorkerCount} משובצים · {staffing.openSlots} פתוחים
                          </span>
                        </div>
                        <StaffingStateSummary
                          shifts={summaryShifts}
                          requiredWorkerCount={job.requiredWorkerCount}
                          className="col-span-2"
                        />
                      </div>
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
