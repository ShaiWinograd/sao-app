import type { CaseStatusValue } from './case-lifecycle';

// Horizontal lifecycle stepper shown on the project detail page.
// Steps mirror the UI example: פרטים → הצעת מחיר → אישור לקוח → תזמון → ביצוע → סיכום → השלמה
export type CaseStepKey =
  | 'details'
  | 'quotation'
  | 'approval'
  | 'scheduling'
  | 'execution'
  | 'summary'
  | 'closure';

export type CaseLifecycleStep = {
  key: CaseStepKey;
  label: string;
  statuses: CaseStatusValue[];
};

export const CASE_LIFECYCLE_STEPS: CaseLifecycleStep[] = [
  { key: 'details', label: 'פרטים', statuses: ['LEAD'] },
  { key: 'quotation', label: 'הצעת מחיר', statuses: ['QUOTATION_DRAFT'] },
  { key: 'approval', label: 'אישור לקוח', statuses: ['AWAITING_APPROVAL', 'RESERVED'] },
  {
    key: 'scheduling',
    label: 'תזמון',
    statuses: ['APPROVED_NO_DATES', 'PARTIALLY_SCHEDULED', 'READY_FOR_EXECUTION'],
  },
  { key: 'execution', label: 'ביצוע', statuses: ['IN_PROGRESS'] },
  { key: 'summary', label: 'סיכום', statuses: ['AWAITING_COMPLETION', 'AWAITING_BILLING'] },
  { key: 'closure', label: 'תשלום', statuses: ['AWAITING_PAYMENT', 'PAID'] },
];

// Best-effort mapping for legacy statuses so the stepper still renders.
const LEGACY_STEP_INDEX: Partial<Record<CaseStatusValue, number>> = {
  DRAFT: 0,
  ACTIVE: 3,
  READY_FOR_REVIEW: 5,
  COMPLETED: 6,
};

// Returns the zero-based index of the current step, or -1 when the status has
// no place on the stepper (e.g. CANCELLED).
export function getCaseStepIndex(status: CaseStatusValue): number {
  const index = CASE_LIFECYCLE_STEPS.findIndex((step) => step.statuses.includes(status));
  if (index !== -1) return index;
  return LEGACY_STEP_INDEX[status] ?? -1;
}

// The five per-step states from the spec (§3 Progress stepper).
export type CaseStepState = 'complete' | 'current' | 'attention' | 'blocked' | 'not-started';

// Statuses where the current step is stuck waiting on an admin/customer action
// and should be highlighted as "requires attention".
const ATTENTION_STATUSES: CaseStatusValue[] = [
  'AWAITING_APPROVAL',
  'APPROVED_NO_DATES',
  'PARTIALLY_SCHEDULED',
  'AWAITING_COMPLETION',
  'AWAITING_BILLING',
  'AWAITING_PAYMENT',
];

// Resolves the state of a single step given the project status. Steps before the
// current one are complete, later steps are not-started, and the current step is
// either "current", "attention", or (when explicitly blocked) "blocked".
export function getCaseStepState(
  status: CaseStatusValue,
  stepIndex: number,
  options?: { blocked?: boolean },
): CaseStepState {
  const current = getCaseStepIndex(status);
  if (current === -1) return 'not-started';
  if (stepIndex < current) return 'complete';
  if (stepIndex > current) return 'not-started';
  if (options?.blocked) return 'blocked';
  return ATTENTION_STATUSES.includes(status) ? 'attention' : 'current';
}

export type CaseDetailTab = 'overview' | 'quotations' | 'jobs' | 'activity';

export type CaseNextAction = {
  title: string;
  cta: string;
  tab: CaseDetailTab;
};

const NEXT_ACTIONS: Partial<Record<CaseStatusValue, CaseNextAction>> = {
  LEAD: { title: 'הכנת הצעת מחיר ללקוח', cta: 'מעבר להצעות מחיר', tab: 'quotations' },
  QUOTATION_DRAFT: { title: 'שליחת הצעת המחיר ללקוח', cta: 'מעבר להצעות מחיר', tab: 'quotations' },
  AWAITING_APPROVAL: { title: 'תיעוד אישור הלקוח להצעת המחיר', cta: 'מעבר להצעות מחיר', tab: 'quotations' },
  RESERVED: { title: 'תיאום תאריכים סופיים מול הלקוח', cta: 'מעבר לעבודות', tab: 'jobs' },
  APPROVED_NO_DATES: { title: 'קביעת תאריכים לעבודות הפרוייקט', cta: 'מעבר לעבודות', tab: 'jobs' },
  PARTIALLY_SCHEDULED: { title: 'השלמת תזמון כל העבודות', cta: 'מעבר לעבודות', tab: 'jobs' },
  READY_FOR_EXECUTION: { title: 'פרסום העבודות לעובדים', cta: 'מעבר לעבודות', tab: 'jobs' },
  IN_PROGRESS: { title: 'מעקב אחר ביצוע העבודות', cta: 'מעבר לעבודות', tab: 'jobs' },
  AWAITING_COMPLETION: { title: 'השלמת דיווחים וטפסים', cta: 'מעבר לפעילות', tab: 'activity' },
  AWAITING_BILLING: { title: 'הפקת חשבונית ללקוח', cta: 'מעבר לסקירה', tab: 'overview' },
  AWAITING_PAYMENT: { title: 'גביית התשלום מהלקוח', cta: 'מעבר לסקירה', tab: 'overview' },
};

// Returns the recommended next action for the project, or null when nothing is
// pending (paid, cancelled, or a legacy status without a mapped action).
export function getCaseNextAction(status: CaseStatusValue): CaseNextAction | null {
  return NEXT_ACTIONS[status] ?? null;
}
