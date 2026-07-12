// Full project (customer case) lifecycle state machine.
// Legacy states (DRAFT/ACTIVE/READY_FOR_REVIEW/COMPLETED) are retained so
// existing data and UI keep working while the new lifecycle is rolled out.

export type CaseStatusValue =
  | 'DRAFT'
  | 'ACTIVE'
  | 'READY_FOR_REVIEW'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'LEAD'
  | 'QUOTATION_DRAFT'
  | 'AWAITING_APPROVAL'
  | 'RESERVED'
  | 'APPROVED_NO_DATES'
  | 'PARTIALLY_SCHEDULED'
  | 'READY_FOR_EXECUTION'
  | 'IN_PROGRESS'
  | 'AWAITING_COMPLETION'
  | 'AWAITING_BILLING'
  | 'AWAITING_PAYMENT'
  | 'PAID';

export type CaseLifecyclePhase =
  | 'sale_planning'
  | 'execution'
  | 'payment_closure'
  | 'terminal'
  | 'legacy';

export const CASE_STATUS_PHASE: Record<CaseStatusValue, CaseLifecyclePhase> = {
  LEAD: 'sale_planning',
  QUOTATION_DRAFT: 'sale_planning',
  AWAITING_APPROVAL: 'sale_planning',
  RESERVED: 'sale_planning',
  APPROVED_NO_DATES: 'execution',
  PARTIALLY_SCHEDULED: 'execution',
  READY_FOR_EXECUTION: 'execution',
  IN_PROGRESS: 'execution',
  AWAITING_COMPLETION: 'execution',
  AWAITING_BILLING: 'payment_closure',
  AWAITING_PAYMENT: 'payment_closure',
  PAID: 'payment_closure',
  CANCELLED: 'terminal',
  DRAFT: 'legacy',
  ACTIVE: 'legacy',
  READY_FOR_REVIEW: 'legacy',
  COMPLETED: 'legacy',
};

// Allowed forward/back transitions. CANCELLED is reachable from any non-terminal
// state (handled in canTransitionCaseStatus) and is not repeated in every list.
const CASE_TRANSITIONS: Record<CaseStatusValue, CaseStatusValue[]> = {
  // New lifecycle
  LEAD: ['QUOTATION_DRAFT'],
  QUOTATION_DRAFT: ['AWAITING_APPROVAL', 'LEAD'],
  AWAITING_APPROVAL: ['RESERVED', 'APPROVED_NO_DATES', 'QUOTATION_DRAFT'],
  RESERVED: ['APPROVED_NO_DATES', 'AWAITING_APPROVAL'],
  APPROVED_NO_DATES: ['PARTIALLY_SCHEDULED', 'READY_FOR_EXECUTION'],
  PARTIALLY_SCHEDULED: ['READY_FOR_EXECUTION', 'APPROVED_NO_DATES'],
  READY_FOR_EXECUTION: ['IN_PROGRESS', 'PARTIALLY_SCHEDULED'],
  IN_PROGRESS: ['AWAITING_COMPLETION', 'AWAITING_BILLING'],
  AWAITING_COMPLETION: ['AWAITING_BILLING', 'IN_PROGRESS'],
  AWAITING_BILLING: ['AWAITING_PAYMENT'],
  AWAITING_PAYMENT: ['PAID', 'AWAITING_BILLING'],
  PAID: [],
  // Terminal (reopenable)
  CANCELLED: ['ACTIVE', 'LEAD'],
  // Legacy (kept permissive so current board flows are not broken)
  DRAFT: ['ACTIVE', 'LEAD'],
  ACTIVE: ['DRAFT', 'READY_FOR_REVIEW', 'COMPLETED', 'IN_PROGRESS'],
  READY_FOR_REVIEW: ['ACTIVE', 'COMPLETED', 'AWAITING_BILLING'],
  COMPLETED: ['ACTIVE', 'AWAITING_BILLING'],
};

export function isTerminalCaseStatus(status: CaseStatusValue): boolean {
  return status === 'PAID';
}

export function getAllowedCaseTransitions(from: CaseStatusValue): CaseStatusValue[] {
  const base = CASE_TRANSITIONS[from] ?? [];
  // Any non-terminal state can be cancelled.
  if (from === 'CANCELLED' || isTerminalCaseStatus(from)) return [...base];
  return base.includes('CANCELLED') ? [...base] : [...base, 'CANCELLED'];
}

export function canTransitionCaseStatus(from: CaseStatusValue, to: CaseStatusValue): boolean {
  if (from === to) return true;
  return getAllowedCaseTransitions(from).includes(to);
}
