import { businessDateKey, UserRole } from '@workforce/shared';

export type JobEditLockDecision =
  | { allowed: true; locked: boolean }
  | { allowed: false; locked: true; statusCode: 403 | 409; error: string; message: string };

export function evaluateJobEditLock(input: {
  status: string;
  date: Date;
  now: Date;
  role: UserRole;
  confirmed: boolean;
}): JobEditLockDecision {
  const locked =
    input.status === 'COMPLETED' ||
    businessDateKey(input.date) < businessDateKey(input.now);
  if (!locked) return { allowed: true, locked: false };
  if (input.role !== UserRole.OWNER) {
    return {
      allowed: false,
      locked: true,
      statusCode: 403,
      error: 'LOCKED_JOB_OWNER_REQUIRED',
      message: 'רק בעלת העסק יכולה לשנות עבודה שהושלמה או שמועדה עבר.',
    };
  }
  if (!input.confirmed) {
    return {
      allowed: false,
      locked: true,
      statusCode: 409,
      error: 'LOCKED_JOB_CONFIRMATION_REQUIRED',
      message: 'העבודה נעולה משום שהושלמה או שמועדה עבר. יש לאשר במפורש את השינוי.',
    };
  }
  return { allowed: true, locked: true };
}
