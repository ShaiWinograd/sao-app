import { describe, expect, it } from 'vitest';
import {
  CASE_STATUS_PHASE,
  canTransitionCaseStatus,
  getAllowedCaseTransitions,
  isTerminalCaseStatus,
} from './case-lifecycle';

describe('canTransitionCaseStatus', () => {
  it('allows forward lifecycle transitions', () => {
    expect(canTransitionCaseStatus('LEAD', 'QUOTATION_DRAFT')).toBe(true);
    expect(canTransitionCaseStatus('AWAITING_APPROVAL', 'APPROVED_NO_DATES')).toBe(true);
    expect(canTransitionCaseStatus('APPROVED_NO_DATES', 'PARTIALLY_SCHEDULED')).toBe(true);
    expect(canTransitionCaseStatus('AWAITING_BILLING', 'AWAITING_PAYMENT')).toBe(true);
    expect(canTransitionCaseStatus('AWAITING_PAYMENT', 'PAID')).toBe(true);
  });

  it('rejects skipping lifecycle phases', () => {
    expect(canTransitionCaseStatus('LEAD', 'PAID')).toBe(false);
    expect(canTransitionCaseStatus('APPROVED_NO_DATES', 'AWAITING_PAYMENT')).toBe(false);
    expect(canTransitionCaseStatus('QUOTATION_DRAFT', 'IN_PROGRESS')).toBe(false);
  });

  it('allows cancelling any non-terminal state', () => {
    expect(canTransitionCaseStatus('LEAD', 'CANCELLED')).toBe(true);
    expect(canTransitionCaseStatus('IN_PROGRESS', 'CANCELLED')).toBe(true);
    expect(canTransitionCaseStatus('AWAITING_PAYMENT', 'CANCELLED')).toBe(true);
  });

  it('does not allow cancelling a fully paid project', () => {
    expect(canTransitionCaseStatus('PAID', 'CANCELLED')).toBe(false);
    expect(getAllowedCaseTransitions('PAID')).toEqual([]);
  });

  it('allows reopening a cancelled project', () => {
    expect(canTransitionCaseStatus('CANCELLED', 'ACTIVE')).toBe(true);
    expect(canTransitionCaseStatus('CANCELLED', 'LEAD')).toBe(true);
  });

  it('treats same-state as a no-op transition', () => {
    expect(canTransitionCaseStatus('IN_PROGRESS', 'IN_PROGRESS')).toBe(true);
  });

  it('keeps legacy board moves working', () => {
    expect(canTransitionCaseStatus('DRAFT', 'ACTIVE')).toBe(true);
    expect(canTransitionCaseStatus('ACTIVE', 'READY_FOR_REVIEW')).toBe(true);
    expect(canTransitionCaseStatus('READY_FOR_REVIEW', 'COMPLETED')).toBe(true);
    expect(canTransitionCaseStatus('COMPLETED', 'ACTIVE')).toBe(true);
  });
});

describe('isTerminalCaseStatus', () => {
  it('marks only PAID as terminal', () => {
    expect(isTerminalCaseStatus('PAID')).toBe(true);
    expect(isTerminalCaseStatus('CANCELLED')).toBe(false);
    expect(isTerminalCaseStatus('IN_PROGRESS')).toBe(false);
  });
});

describe('CASE_STATUS_PHASE', () => {
  it('groups statuses into lifecycle phases', () => {
    expect(CASE_STATUS_PHASE.QUOTATION_DRAFT).toBe('sale_planning');
    expect(CASE_STATUS_PHASE.IN_PROGRESS).toBe('execution');
    expect(CASE_STATUS_PHASE.AWAITING_PAYMENT).toBe('payment_closure');
    expect(CASE_STATUS_PHASE.CANCELLED).toBe('terminal');
    expect(CASE_STATUS_PHASE.ACTIVE).toBe('legacy');
  });
});
