import type { StatusTone } from './status-tone';

// Job status badge vocabulary from the UX spec (§11 Status badges → Job).
// The base persisted status (DRAFT/PUBLISHED/IN_PROGRESS/COMPLETED/CANCELLED)
// is refined into a staffing-aware badge so the admin can see at a glance
// whether a published job is fully staffed, missing workers, or missing a
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
    case 'CANCELLED':
      return { label: 'בוטלה', tone: 'neutral' };
    case 'COMPLETED':
      return { label: 'הושלמה', tone: 'success' };
    case 'IN_PROGRESS':
      return { label: 'בביצוע', tone: 'info' };
    case 'DRAFT':
      return { label: 'טיוטה', tone: 'neutral' };
    case 'PUBLISHED': {
      if (input.attendanceReviewPending) {
        return { label: 'מחכה לבדיקת נוכחות', tone: 'warning' };
      }
      if (input.assignedWorkerCount < input.requiredWorkerCount) {
        return { label: 'חסרים עובדים', tone: 'warning' };
      }
      if (input.requiresManager && !input.hasManager) {
        return { label: 'חסר ראש צוות', tone: 'warning' };
      }
      return { label: 'מאוישת', tone: 'success' };
    }
    default:
      return { label: input.status, tone: 'neutral' };
  }
}
