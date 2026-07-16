// Shared types + helpers for the worker web experience (worker_web_spec).

export type WorkerJob = {
  id: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: string;
  plannedStart: string;
  plannedEnd: string;
  requiredWorkerCount: number;
  workerVisibleNotes?: string | null;
  status?: string;
  address?: {
    fullAddress?: string;
    apartmentDetails?: string | null;
    parkingNotes?: string | null;
    accessNotes?: string | null;
    elevatorNotes?: string | null;
  } | null;
  customer?: { firstName?: string; lastName?: string } | null;
  slots?: Array<{ id: string; requiredSkill?: string | null; filledByShiftId?: string | null }>;
  shifts?: Array<{ workerId?: string; joinRequestStatus?: string; worker?: { firstName?: string; lastName?: string } }>;
};

export type WorkerShift = {
  id: string;
  jobId: string;
  scheduledStart: string;
  scheduledEnd: string;
  attendanceStatus: string;
  joinRequestStatus: string;
  formStatus: string;
  job: WorkerJob;
};

export const JOB_TYPE_LABEL: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

export function jobTypeLabel(type: string): string {
  return JOB_TYPE_LABEL[type] ?? type;
}

export function jobTypeClasses(type: string): string {
  if (type === 'PACKING') return 'border-sky-200 bg-sky-50 text-sky-800';
  if (type === 'UNPACKING') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-purple-200 bg-purple-50 text-purple-800';
}

export function formatDate(iso: string | undefined | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export function formatTime(iso: string | undefined | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function customerName(customer?: { firstName?: string; lastName?: string } | null): string {
  return `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim() || 'לקוח/ה';
}

export function dateKey(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Open positions on a job = required workers minus non-rejected/cancelled shifts.
export function openPositions(job: WorkerJob): number {
  const filled = (job.shifts ?? []).filter(
    (s) => s.joinRequestStatus === 'APPROVED' || s.joinRequestStatus === 'PENDING' || s.joinRequestStatus === 'WAITLISTED',
  ).length;
  return Math.max((job.requiredWorkerCount ?? 0) - filled, 0);
}

export function attendanceBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'CLOCKED_IN':
      return { label: 'בעבודה', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
    case 'CLOCKED_OUT':
    case 'CORRECTED':
    case 'AUTO_CLOCKED_OUT':
      return { label: 'הושלם', className: 'border-gray-200 bg-gray-100 text-gray-600' };
    case 'NO_SHOW':
      return { label: 'לא הגיע/ה', className: 'border-rose-200 bg-rose-50 text-rose-700' };
    default:
      return { label: 'מתוזמן', className: 'border-sky-200 bg-sky-50 text-sky-700' };
  }
}

// A "form missing" badge is only meaningful once the shift has been clocked out.
export function missingFormBadge(shift: { attendanceStatus: string; formStatus: string }): boolean {
  const clockedOut = ['CLOCKED_OUT', 'CORRECTED', 'AUTO_CLOCKED_OUT'].includes(shift.attendanceStatus);
  return clockedOut && shift.formStatus === 'NOT_SUBMITTED';
}

// A shift is "active" for the worker (shows on the calendar) unless rejected/cancelled.
export function isActiveShift(status: string): boolean {
  return status === 'APPROVED' || status === 'PENDING' || status === 'WAITLISTED';
}
