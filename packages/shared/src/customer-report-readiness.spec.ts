import { describe, expect, it } from 'vitest';
import { isCaseReadyForReport } from './customer-report-readiness';

const completed = { status: 'COMPLETED', hasUnresolvedAttendance: false };

describe('isCaseReadyForReport (§18.1)', () => {
  it('is ready when the case is ACTIVE, all jobs Completed, attendance resolved, no report', () => {
    expect(isCaseReadyForReport({ caseStatus: 'ACTIVE', hasFinalizedReport: false, jobs: [completed, completed] })).toBe(true);
  });

  it('is not ready when a job is not Completed', () => {
    expect(
      isCaseReadyForReport({ caseStatus: 'ACTIVE', hasFinalizedReport: false, jobs: [completed, { status: 'APPROVED', hasUnresolvedAttendance: false }] }),
    ).toBe(false);
  });

  it('is not ready when attendance is unresolved', () => {
    expect(
      isCaseReadyForReport({ caseStatus: 'ACTIVE', hasFinalizedReport: false, jobs: [{ status: 'COMPLETED', hasUnresolvedAttendance: true }] }),
    ).toBe(false);
  });

  it('is NOT blocked by missing end-of-job forms (forms are not an input)', () => {
    // Readiness has no notion of forms — a completed, attendance-resolved job is ready.
    expect(isCaseReadyForReport({ caseStatus: 'ACTIVE', hasFinalizedReport: false, jobs: [completed] })).toBe(true);
  });

  it('ignores ARCHIVED jobs but still requires at least one Completed job', () => {
    expect(
      isCaseReadyForReport({ caseStatus: 'ACTIVE', hasFinalizedReport: false, jobs: [completed, { status: 'ARCHIVED', hasUnresolvedAttendance: false }] }),
    ).toBe(true);
    expect(
      isCaseReadyForReport({ caseStatus: 'ACTIVE', hasFinalizedReport: false, jobs: [{ status: 'ARCHIVED', hasUnresolvedAttendance: false }] }),
    ).toBe(false);
  });

  it('is not ready for a CLOSED case or when a finalized report exists', () => {
    expect(isCaseReadyForReport({ caseStatus: 'CLOSED', hasFinalizedReport: true, jobs: [completed] })).toBe(false);
    expect(isCaseReadyForReport({ caseStatus: 'ACTIVE', hasFinalizedReport: true, jobs: [completed] })).toBe(false);
  });

  it('is not ready with no jobs', () => {
    expect(isCaseReadyForReport({ caseStatus: 'ACTIVE', hasFinalizedReport: false, jobs: [] })).toBe(false);
  });
});
