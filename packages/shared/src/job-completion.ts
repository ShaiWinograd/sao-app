// Automatic job completion rule (spec §16.6, §17.1).
//
// A job may move to COMPLETED only once EVERY expected regular worker and team
// leader has a resolved outcome: valid worked attendance (clocked in and out with
// nothing awaiting review) OR an explicit "Did not work" (NO_SHOW). The following
// do NOT block completion: missing end-of-shift forms, backup workers who did not
// work, and removed workers. A backup who actually worked becomes a participant
// and must also be fully resolved. An automatic clock-out / correction awaiting
// owner review blocks completion until resolved.

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

function isResolvedOutcome(s: CompletionShift, reasons: Set<string>): void {
  // Explicit "Did not work" is a resolved outcome (spec §16.5).
  if (s.attendanceStatus === 'NO_SHOW') return;
  // Otherwise the worker must have valid worked attendance.
  if (s.actualStart == null) {
    reasons.add('a worker has no attendance outcome yet');
    return;
  }
  if (s.attendanceStatus === 'CLOCKED_IN' || s.actualEnd == null) {
    reasons.add('a worker has not clocked out');
  }
  if (s.requiresReview) {
    reasons.add('attendance awaiting owner review');
  }
}

export function evaluateJobCompletion(shifts: CompletionShift[]): JobCompletionResult {
  const reasons = new Set<string>();

  // Regular (non-backup) approved workers, including team leaders. Every one of
  // them must reach a resolved outcome before the job can complete (§17.1).
  const regulars = shifts.filter(
    (s) => s.joinRequestStatus === 'APPROVED' && s.assignmentRole !== 'BACKUP',
  );

  if (regulars.length === 0) {
    return { complete: false, blockingReasons: ['no regular worker assigned'] };
  }

  for (const s of regulars) isResolvedOutcome(s, reasons);

  // A backup who actually worked becomes a worked participant (§16.6) and must
  // also be clocked out with nothing awaiting review. Backups who did not work
  // are ignored.
  const workedBackups = shifts.filter(
    (s) => s.joinRequestStatus === 'APPROVED' && s.assignmentRole === 'BACKUP' && s.actualStart != null,
  );
  for (const s of workedBackups) isResolvedOutcome(s, reasons);

  return { complete: reasons.size === 0, blockingReasons: [...reasons] };
}
