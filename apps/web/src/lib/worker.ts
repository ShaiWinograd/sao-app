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
  formTemplate?: { id: string; name: string; questions: WorkerFormQuestion[] } | null;
};

export type WorkerFormQuestionType =
  | 'YES_NO'
  | 'MULTIPLE_CHOICE'
  | 'CHECKBOX'
  | 'NUMBER'
  | 'SHORT_TEXT'
  | 'LONG_TEXT'
  | 'PHOTO_UPLOAD'
  | 'DATE'
  | 'SIGNATURE';

export type WorkerFormQuestion = {
  id: string;
  questionText: string;
  type: WorkerFormQuestionType;
  visibility: 'WORKER' | 'ADMIN' | 'OWNER';
  isRequired: boolean;
  order: number;
  options: string[];
};

export type WorkerAnswerValue = string | number | boolean | string[];

export type WorkerShift = {
  id: string;
  jobId: string;
  scheduledStart: string;
  scheduledEnd: string;
  attendanceStatus: string;
  joinRequestStatus: string;
  assignmentRole?: string;
  formStatus: string;
  actualStart?: string | null;
  actualEnd?: string | null;
  approvedHours?: number | string | null;
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
  if (type === 'PACKING') return 'border-red-200 bg-red-50 text-red-800';
  if (type === 'UNPACKING') return 'border-amber-200 bg-amber-50 text-amber-800';
  return 'border-blue-200 bg-blue-50 text-blue-800';
}

// Solid, high-contrast fill for a fully-assigned shift card.
export function jobTypeSolidClasses(type: string): string {
  if (type === 'PACKING') return 'bg-red-600 text-white';
  if (type === 'UNPACKING') return 'bg-amber-600 text-white';
  return 'bg-blue-600 text-white';
}

// Border color for cards that need a full type-colored outline.
export function jobTypeBorderColor(type: string): string {
  if (type === 'PACKING') return 'border-red-500';
  if (type === 'UNPACKING') return 'border-amber-500';
  return 'border-blue-500';
}

// Solid strip color (used as a side accent on open/pending cards).
export function jobTypeStripColor(type: string): string {
  if (type === 'PACKING') return 'bg-red-500';
  if (type === 'UNPACKING') return 'bg-amber-500';
  return 'bg-blue-500';
}

// Light tint background for the worker's own confirmed shift.
export function jobTypeTintClasses(type: string): string {
  if (type === 'PACKING') return 'bg-red-50';
  if (type === 'UNPACKING') return 'bg-amber-50';
  return 'bg-blue-50';
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

// Full date (day.month.year) for history/detail headers.
export function formatFullDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

// Approved payable duration in Hebrew, e.g. "5 שעות ו-19 דקות".
export function formatDuration(hours?: number | string | null): string {
  const h = Number(hours);
  if (!h || Number.isNaN(h)) return '—';
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh && mm) return `${hh} שעות ו-${mm} דקות`;
  if (hh) return `${hh} שעות`;
  return `${mm} דקות`;
}

export function assignmentRoleLabel(role?: string): string | null {
  if (role === 'TEAM_LEADER') return 'ראש צוות';
  if (role === 'BACKUP') return 'מחליף';
  return null;
}

export function formStatusLabel(status: string): string {
  return status === 'SUBMITTED' ? 'הוגש' : status === 'WAIVED' ? 'לא נדרש' : 'לא הוגש';
}

// Open positions on a job = required workers minus non-rejected/cancelled shifts.
export function openPositions(job: WorkerJob): number {
  const filled = (job.shifts ?? []).filter(
    (s) => s.joinRequestStatus === 'APPROVED' || s.joinRequestStatus === 'PENDING' || s.joinRequestStatus === 'AWAITING_WORKER',
  ).length;
  return Math.max((job.requiredWorkerCount ?? 0) - filled, 0);
}

export function attendanceBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'CLOCKED_IN':
      return { label: 'בעבודה', className: 'border-primary-200 bg-primary-50 text-primary-700' };
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
  return status === 'APPROVED' || status === 'PENDING' || status === 'AWAITING_WORKER';
}
