import { describe, expect, it } from 'vitest';
import { deriveJobStatusBadge } from './job-status';

const base = {
  status: 'RESERVATION',
  requiredWorkerCount: 3,
  assignedWorkerCount: 3,
  requiresManager: true,
  hasManager: true,
};

describe('deriveJobStatusBadge', () => {
  it('shows reservation label for a fully staffed reservation', () => {
    expect(deriveJobStatusBadge(base)).toEqual({ label: 'שריון', tone: 'info' });
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
    expect(deriveJobStatusBadge(base)).toEqual({ label: 'שריון', tone: 'info' });
  });

  it('ignores manager when not required', () => {
    expect(deriveJobStatusBadge({ ...base, requiresManager: false, hasManager: false })).toEqual({
      label: 'שריון',
      tone: 'info',
    });
  });

  it('shows attendance review pending', () => {
    expect(deriveJobStatusBadge({ ...base, attendanceReviewPending: true })).toEqual({
      label: 'מחכה לבדיקת נוכחות',
      tone: 'warning',
    });
  });

  it('maps approved, completed and archived', () => {
    expect(deriveJobStatusBadge({ ...base, status: 'APPROVED' }).label).toBe('אושר');
    expect(deriveJobStatusBadge({ ...base, status: 'COMPLETED' }).label).toBe('בוצע');
    expect(deriveJobStatusBadge({ ...base, status: 'ARCHIVED' }).label).toBe('בארכיון');
  });
});
