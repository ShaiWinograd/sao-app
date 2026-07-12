export type StaffingInsightInput = {
  requiredWorkers: number;
  assignedWorkers: number;
  requiresManager: boolean;
  hasAssignedManager: boolean;
  status?: 'planned' | 'active' | 'done';
};

export type StaffingIssueBreakdown = {
  workerShortageSlots: number;
  managerShortage: boolean;
  isReadyForExecution: boolean;
};

export type StaffingSummary = {
  agreedSlots: number;
  scheduledSlots: number;
  actualSlots: number;
};

export function getStaffingIssueBreakdown(input: StaffingInsightInput): StaffingIssueBreakdown {
  const workerShortageSlots = Math.max(input.requiredWorkers - input.assignedWorkers, 0);
  const managerShortage = input.requiresManager && !input.hasAssignedManager;

  return {
    workerShortageSlots,
    managerShortage,
    isReadyForExecution: workerShortageSlots === 0 && !managerShortage,
  };
}

export function summarizeAgreedScheduledActual(inputs: StaffingInsightInput[]): StaffingSummary {
  const agreedSlots = inputs.reduce((sum, input) => sum + Math.max(input.requiredWorkers, 0), 0);
  const scheduledSlots = inputs.reduce(
    (sum, input) => sum + Math.min(Math.max(input.assignedWorkers, 0), Math.max(input.requiredWorkers, 0)),
    0,
  );
  const actualSlots = inputs.reduce((sum, input) => {
    if (input.status !== 'done') return sum;
    return sum + Math.min(Math.max(input.assignedWorkers, 0), Math.max(input.requiredWorkers, 0));
  }, 0);

  return {
    agreedSlots,
    scheduledSlots,
    actualSlots,
  };
}
