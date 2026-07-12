export type EndShiftCompletionStatus = 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED';

export type EndShiftSubmissionWindow = {
  elapsedMinutes: number;
  remainingMinutes: number;
  isExpired: boolean;
};

const END_SHIFT_SUBMISSION_WINDOW_MINUTES = 120;

export function calculateEndShiftSubmissionWindow(
  clockOutAt: Date | string,
  now: Date = new Date(),
): EndShiftSubmissionWindow | null {
  const clockOut = typeof clockOutAt === 'string' ? new Date(clockOutAt) : clockOutAt;
  if (Number.isNaN(clockOut.getTime())) return null;

  const elapsedMinutes = Math.floor((now.getTime() - clockOut.getTime()) / (1000 * 60));
  const remainingMinutes = END_SHIFT_SUBMISSION_WINDOW_MINUTES - elapsedMinutes;

  return {
    elapsedMinutes,
    remainingMinutes,
    isExpired: elapsedMinutes > END_SHIFT_SUBMISSION_WINDOW_MINUTES,
  };
}

export function requiresManagerNoteForEndShift(status: EndShiftCompletionStatus): boolean {
  return status === 'PARTIALLY_COMPLETED' || status === 'NOT_COMPLETED';
}

export function mapHebrewEndShiftStatusToApi(
  status: 'הושלם' | 'הושלם חלקית' | 'חסר מידע',
): EndShiftCompletionStatus {
  if (status === 'הושלם') return 'COMPLETED';
  if (status === 'הושלם חלקית') return 'PARTIALLY_COMPLETED';
  return 'NOT_COMPLETED';
}
