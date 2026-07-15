import { describe, expect, it } from 'vitest';
import { deriveJobStatusBadge } from './job-status';

const base = {
  status: 'PUBLISHED',
  requiredWorkerCount: 3,
  assignedWorkerCount: 3,
  requiresManager: true,
  hasManager: true,
};

describe('deriveJobStatusBadge', () => {
  it('returns draft for unpublished jobs', () => {
    expect(deriveJobStatusBadge({ ...base, status: 'DRAFT' })).toEqual({ label: 'טיוטה', tone: 'neutral' });
  });

  it('flags missing workers first', () => {
    expect(deriveJobStatusBadge({ ...base, assignedWorkerCount: 1 })).toEqual({
      label: 'חסרים עובדים',
      tone: 'warning',
    });
  });

  it('flags a missing manager when workers are full', () => {
    expect(deriveJobStatusBadge({ ...base, hasManager: false })).toEqual({
      label: 'חסר ראש צוות',
      tone: 'warning',
    });
  });

  it('shows fully staffed', () => {
    expect(deriveJobStatusBadge(base)).toEqual({ label: 'מאוישת', tone: 'success' });
  });

  it('ignores manager when not required', () => {
    expect(deriveJobStatusBadge({ ...base, requiresManager: false, hasManager: false })).toEqual({
      label: 'מאוישת',
      tone: 'success',
    });
  });

  it('shows attendance review pending', () => {
    expect(deriveJobStatusBadge({ ...base, attendanceReviewPending: true })).toEqual({
      label: 'מחכה לבדיקת נוכחות',
      tone: 'warning',
    });
  });

  it('maps in-progress, completed and cancelled', () => {
    expect(deriveJobStatusBadge({ ...base, status: 'IN_PROGRESS' }).label).toBe('בביצוע');
    expect(deriveJobStatusBadge({ ...base, status: 'COMPLETED' }).label).toBe('הושלמה');
    expect(deriveJobStatusBadge({ ...base, status: 'CANCELLED' }).label).toBe('בוטלה');
  });
});
