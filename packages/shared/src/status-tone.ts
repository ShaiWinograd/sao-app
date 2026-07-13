import type { CaseStatusValue } from './case-lifecycle';

// Semantic tone shared by all status badges. Maps to UI_VISUAL_DESIGN_SPEC §2.4.
export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const CASE_STATUS_TONE: Record<CaseStatusValue, StatusTone> = {
  LEAD: 'info',
  QUOTATION_DRAFT: 'neutral',
  AWAITING_APPROVAL: 'warning',
  RESERVED: 'info',
  APPROVED_NO_DATES: 'warning',
  PARTIALLY_SCHEDULED: 'warning',
  READY_FOR_EXECUTION: 'success',
  IN_PROGRESS: 'info',
  AWAITING_COMPLETION: 'warning',
  AWAITING_BILLING: 'warning',
  AWAITING_PAYMENT: 'warning',
  PAID: 'success',
  CANCELLED: 'neutral',
  // Legacy
  DRAFT: 'neutral',
  ACTIVE: 'info',
  READY_FOR_REVIEW: 'warning',
  COMPLETED: 'success',
};

export function caseStatusTone(status: CaseStatusValue): StatusTone {
  return CASE_STATUS_TONE[status] ?? 'neutral';
}
