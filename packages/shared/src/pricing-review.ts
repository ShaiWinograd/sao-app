import type { StatusTone } from './status-tone';

// Reasons the final customer amount may still require manual review before the
// project can be billed (§10 Final review).
export type FinalReviewReason =
  | 'ATTENDANCE_CORRECTION_PENDING'
  | 'MISSING_FORM'
  | 'MANUAL_PRICING_RULE'
  | 'ADDITIONAL_WORK'
  | 'DISCOUNT_UNCONFIRMED';

export const FINAL_REVIEW_REASON_LABELS: Record<FinalReviewReason, string> = {
  ATTENDANCE_CORRECTION_PENDING: 'תיקון נוכחות ממתין לאישור',
  MISSING_FORM: 'טופס חסר',
  MANUAL_PRICING_RULE: 'כלל תמחור ידני',
  ADDITIONAL_WORK: 'עבודה נוספת שלא נכללה',
  DISCOUNT_UNCONFIRMED: 'הנחה שלא אושרה',
};

export type CustomerPricingInput = {
  quotationEstimate: number;
  scheduledEstimate: number;
  actualBillableHours: number | null;
  fixedFees: number;
  supplies: number;
  discounts: number;
  hourlyRate: number;
};

// Derives the customer-facing final amount from actual billable hours (falling
// back to the scheduled estimate when actuals are not yet known) plus fixed
// fees and supplies, less discounts.
export function computeFinalAmount(input: CustomerPricingInput): number {
  const laborBase =
    input.actualBillableHours != null
      ? input.actualBillableHours * input.hourlyRate
      : input.scheduledEstimate;
  const total = laborBase + input.fixedFees + input.supplies - input.discounts;
  return Math.max(0, Math.round(total));
}

export type FinalReviewResult = {
  requiresReview: boolean;
  reasons: FinalReviewReason[];
  label: string;
  tone: StatusTone;
};

// Evaluates whether the final amount can be finalized or still needs review.
export function evaluateFinalReview(reasons: FinalReviewReason[]): FinalReviewResult {
  const requiresReview = reasons.length > 0;
  return {
    requiresReview,
    reasons,
    label: requiresReview ? 'הסכום הסופי עדיין דורש בדיקה' : 'הסכום הסופי מוכן לחיוב',
    tone: requiresReview ? 'warning' : 'success',
  };
}
