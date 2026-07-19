import type { StatusTone } from './status-tone';

// Job status badge vocabulary from the UX spec (§11 Status badges → Job).
// The base persisted status (RESERVATION/APPROVED/COMPLETED/ARCHIVED) is
// refined into a staffing-aware badge so the admin can see at a glance
// whether an active job is fully staffed, missing workers, or missing a
// manager.
export type JobStatusBadge = { label: string; tone: StatusTone };

export type JobStatusInput = {
  status: string;
  requiredWorkerCount: number;
  assignedWorkerCount: number;
  requiresManager: boolean;
  hasManager: boolean;
  // Set when the job has ended and attendance still needs admin review.
  attendanceReviewPending?: boolean;
};

export function deriveJobStatusBadge(input: JobStatusInput): JobStatusBadge {
  switch (input.status) {
    case 'ARCHIVED':
      return { label: 'בארכיון', tone: 'neutral' };
    case 'COMPLETED':
      return { label: 'בוצע', tone: 'success' };
    case 'RESERVATION':
    case 'APPROVED': {
      if (input.attendanceReviewPending) {
        return { label: 'מחכה לבדיקת נוכחות', tone: 'warning' };
      }
      if (input.assignedWorkerCount < input.requiredWorkerCount) {
        return { label: 'חסרים עובדים', tone: 'warning' };
      }
      if (input.requiresManager && !input.hasManager) {
        return { label: 'חסר ראש צוות', tone: 'warning' };
      }
      return input.status === 'APPROVED'
        ? { label: 'אושר', tone: 'success' }
        : { label: 'שריון', tone: 'info' };
    }
    default:
      return { label: input.status, tone: 'neutral' };
  }
}
