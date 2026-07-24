import { describe, expect, it } from 'vitest';
import { getStaffingIssueBreakdown, summarizeAgreedScheduledActual } from './staffing-insights';

describe('getStaffingIssueBreakdown', () => {
  it('separates worker and manager shortages', () => {
    const result = getStaffingIssueBreakdown({
      requiredWorkers: 4,
      assignedWorkers: 2,
      requiresManager: true,
      hasAssignedManager: false,
      status: 'planned',
    });

    expect(result.workerShortageSlots).toBe(2);
    expect(result.managerShortage).toBe(true);
    expect(result.isReadyForExecution).toBe(false);
  });

  it('marks job as ready when no shortage exists', () => {
    const result = getStaffingIssueBreakdown({
      requiredWorkers: 3,
      assignedWorkers: 3,
      requiresManager: true,
      hasAssignedManager: true,
      status: 'active',
    });

    expect(result.workerShortageSlots).toBe(0);
    expect(result.managerShortage).toBe(false);
    expect(result.isReadyForExecution).toBe(true);
  });

  // A job requiring 2 workers where one of the two positions must be a shift
  // leader: the leader requirement is a ROLE constraint WITHIN the two required
  // workers, never a substitute for a missing headcount. Total missing-worker
  // count must stay independent from the missing-shift-leader warning.
  describe('required=2 with a reserved shift-leader position', () => {
    const base = { requiredWorkers: 2, requiresManager: true } as const;

    it('0 assigned → missing 2 workers, missing leader', () => {
      const result = getStaffingIssueBreakdown({ ...base, assignedWorkers: 0, hasAssignedManager: false });
      expect(result.workerShortageSlots).toBe(2);
      expect(result.managerShortage).toBe(true);
    });

    it('1 regular worker assigned → missing 1 worker, still missing leader', () => {
      const result = getStaffingIssueBreakdown({ ...base, assignedWorkers: 1, hasAssignedManager: false });
      expect(result.workerShortageSlots).toBe(1);
      expect(result.managerShortage).toBe(true);
    });

    it('1 shift leader assigned → missing 1 worker, leader satisfied', () => {
      const result = getStaffingIssueBreakdown({ ...base, assignedWorkers: 1, hasAssignedManager: true });
      expect(result.workerShortageSlots).toBe(1);
      expect(result.managerShortage).toBe(false);
    });

    it('2 regular workers assigned → 0 missing workers, but leader still unmet', () => {
      const result = getStaffingIssueBreakdown({ ...base, assignedWorkers: 2, hasAssignedManager: false });
      expect(result.workerShortageSlots).toBe(0);
      expect(result.managerShortage).toBe(true);
    });

    it('1 shift leader + 1 regular worker → fully staffed', () => {
      const result = getStaffingIssueBreakdown({ ...base, assignedWorkers: 2, hasAssignedManager: true });
      expect(result.workerShortageSlots).toBe(0);
      expect(result.managerShortage).toBe(false);
    });
  });
});

describe('summarizeAgreedScheduledActual', () => {
  it('keeps agreed, scheduled, and actual values distinct', () => {
    const summary = summarizeAgreedScheduledActual([
      {
        requiredWorkers: 4,
        assignedWorkers: 3,
        requiresManager: true,
        hasAssignedManager: true,
        status: 'planned',
      },
      {
        requiredWorkers: 2,
        assignedWorkers: 2,
        requiresManager: false,
        hasAssignedManager: false,
        status: 'done',
      },
    ]);

    expect(summary.agreedSlots).toBe(6);
    expect(summary.scheduledSlots).toBe(5);
    expect(summary.actualSlots).toBe(2);
  });
});
