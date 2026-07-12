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
