// Project (case) status derived from its jobs' statuses (spec §5). This is the
// operational status of a project in the flexible-reservation model, computed
// from the linked jobs rather than a separate sales-pipeline lifecycle.
//
// Archived jobs are ignored. If no active jobs remain the project is EMPTY
// (a candidate for deletion when no preserved data requires it — spec §5, §25).

export type ProjectStatus =
  | 'EMPTY'
  | 'RESERVATION'
  | 'PARTIALLY_APPROVED'
  | 'APPROVED'
  | 'IN_PROGRESS'
  | 'COMPLETED';

export function deriveProjectStatus(jobStatuses: string[]): ProjectStatus {
  const active = jobStatuses.filter((s) => s !== 'ARCHIVED');
  if (active.length === 0) return 'EMPTY';

  const allCompleted = active.every((s) => s === 'COMPLETED');
  if (allCompleted) return 'COMPLETED';

  // Some (but not all) jobs completed → work is under way (spec §5).
  const anyCompleted = active.some((s) => s === 'COMPLETED');
  if (anyCompleted) return 'IN_PROGRESS';

  const allApproved = active.every((s) => s === 'APPROVED');
  if (allApproved) return 'APPROVED';

  const anyApproved = active.some((s) => s === 'APPROVED');
  if (anyApproved) return 'PARTIALLY_APPROVED';

  return 'RESERVATION';
}

export const PROJECT_STATUS_HE: Record<ProjectStatus, string> = {
  EMPTY: 'ריק',
  RESERVATION: 'שריון',
  PARTIALLY_APPROVED: 'אושר חלקית',
  APPROVED: 'אושר',
  IN_PROGRESS: 'בביצוע',
  COMPLETED: 'בוצע',
};
