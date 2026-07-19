// Automatic job completion rule (spec §4.3).
//
// A job may move automatically to COMPLETED when all regular workers who worked
// the job have clocked out, with no unresolved attendance issue. The following
// do NOT block completion: missing end-of-shift forms, backup workers who did
// not work, and removed workers. An automatic clock-out awaiting owner review
// blocks completion until resolved.

export type CompletionShift = {
  // Assignment lifecycle status (only APPROVED assignments are considered).
  joinRequestStatus: string;
  // REGULAR | TEAM_LEADER | BACKUP — backups do not block completion.
  assignmentRole: string;
  attendanceStatus: string;
  actualStart: Date | string | null;
  actualEnd: Date | string | null;
  // Auto clock-out / correction awaiting owner review.
  requiresReview: boolean;
};

export type JobCompletionResult = {
  complete: boolean;
  blockingReasons: string[];
};

export function evaluateJobCompletion(shifts: CompletionShift[]): JobCompletionResult {
  const reasons: string[] = [];

  // Regular (non-backup) approved workers who actually worked. Team leaders are
  // regular workers for completion purposes; backups and removed workers are
  // ignored (spec §4.3, §11).
  const regularWorked = shifts.filter(
    (s) =>
      s.joinRequestStatus === 'APPROVED' &&
      s.assignmentRole !== 'BACKUP' &&
      s.actualStart != null,
  );

  if (regularWorked.length === 0) {
    return { complete: false, blockingReasons: ['no regular worker has worked yet'] };
  }

  const notClockedOut = regularWorked.some(
    (s) => s.attendanceStatus === 'CLOCKED_IN' || s.actualEnd == null,
  );
  if (notClockedOut) {
    reasons.push('a regular worker has not clocked out');
  }

  const reviewPending = regularWorked.some((s) => s.requiresReview);
  if (reviewPending) {
    reasons.push('attendance awaiting owner review');
  }

  return { complete: reasons.length === 0, blockingReasons: reasons };
}
