import type { CaseStatusValue } from './case-lifecycle';
import type { QuotationStatus } from './quotations';

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

const CASE_STATUS_LABEL: Record<CaseStatusValue, string> = {
  DRAFT: 'טיוטה',
  ACTIVE: 'פעיל',
  READY_FOR_REVIEW: 'לבדיקה',
  COMPLETED: 'הושלם',
  CANCELLED: 'בוטל',
  LEAD: 'ליד חדש',
  QUOTATION_DRAFT: 'בהכנת הצעת מחיר',
  AWAITING_APPROVAL: 'מחכה לאישור',
  RESERVED: 'משוריין',
  APPROVED_NO_DATES: 'מאושר – ללא תאריכים',
  PARTIALLY_SCHEDULED: 'תזמון חלקי',
  READY_FOR_EXECUTION: 'מאושר לביצוע',
  IN_PROGRESS: 'בביצוע',
  AWAITING_COMPLETION: 'מחכה להשלמות',
  AWAITING_BILLING: 'מחכה לחיוב',
  AWAITING_PAYMENT: 'מחכה לתשלום',
  PAID: 'שולם',
};

export function caseStatusLabel(status: CaseStatusValue): string {
  return CASE_STATUS_LABEL[status] ?? status;
}

const QUOTATION_STATUS_TONE: Record<QuotationStatus, StatusTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  APPROVED: 'success',
  REJECTED: 'error',
  EXPIRED: 'warning',
};

export function quotationStatusTone(status: QuotationStatus): StatusTone {
  return QUOTATION_STATUS_TONE[status] ?? 'neutral';
}

export type InvoiceStatusValue = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';

const INVOICE_STATUS_TONE: Record<InvoiceStatusValue, StatusTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  VOID: 'neutral',
};

export function invoiceStatusTone(status: InvoiceStatusValue): StatusTone {
  return INVOICE_STATUS_TONE[status] ?? 'neutral';
}
