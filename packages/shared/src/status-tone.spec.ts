import { describe, expect, it } from 'vitest';
import { caseStatusTone, invoiceStatusTone, quotationStatusTone } from './status-tone';

describe('caseStatusTone', () => {
  it('maps approved/paid states to success', () => {
    expect(caseStatusTone('READY_FOR_EXECUTION')).toBe('success');
    expect(caseStatusTone('PAID')).toBe('success');
    expect(caseStatusTone('COMPLETED')).toBe('success');
  });

  it('maps waiting states to warning', () => {
    expect(caseStatusTone('AWAITING_APPROVAL')).toBe('warning');
    expect(caseStatusTone('PARTIALLY_SCHEDULED')).toBe('warning');
    expect(caseStatusTone('AWAITING_PAYMENT')).toBe('warning');
  });

  it('maps in-progress/lead states to info', () => {
    expect(caseStatusTone('IN_PROGRESS')).toBe('info');
    expect(caseStatusTone('LEAD')).toBe('info');
  });

  it('maps draft/cancelled states to neutral', () => {
    expect(caseStatusTone('DRAFT')).toBe('neutral');
    expect(caseStatusTone('CANCELLED')).toBe('neutral');
  });
});

describe('quotationStatusTone', () => {
  it('maps quotation states to semantic tones', () => {
    expect(quotationStatusTone('APPROVED')).toBe('success');
    expect(quotationStatusTone('SENT')).toBe('info');
    expect(quotationStatusTone('REJECTED')).toBe('error');
    expect(quotationStatusTone('EXPIRED')).toBe('warning');
    expect(quotationStatusTone('DRAFT')).toBe('neutral');
  });
});

describe('invoiceStatusTone', () => {
  it('maps invoice states to semantic tones', () => {
    expect(invoiceStatusTone('PAID')).toBe('success');
    expect(invoiceStatusTone('PARTIALLY_PAID')).toBe('warning');
    expect(invoiceStatusTone('SENT')).toBe('info');
    expect(invoiceStatusTone('VOID')).toBe('neutral');
  });
});
