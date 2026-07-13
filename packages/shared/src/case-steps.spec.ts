import { describe, expect, it } from 'vitest';
import {
  CASE_LIFECYCLE_STEPS,
  getCaseNextAction,
  getCaseStepIndex,
} from './case-steps';

describe('case lifecycle steps', () => {
  it('exposes seven ordered steps ending with closure', () => {
    expect(CASE_LIFECYCLE_STEPS).toHaveLength(7);
    expect(CASE_LIFECYCLE_STEPS[0].key).toBe('details');
    expect(CASE_LIFECYCLE_STEPS[6].key).toBe('closure');
  });

  it('maps each lifecycle status to a step index', () => {
    expect(getCaseStepIndex('LEAD')).toBe(0);
    expect(getCaseStepIndex('QUOTATION_DRAFT')).toBe(1);
    expect(getCaseStepIndex('AWAITING_APPROVAL')).toBe(2);
    expect(getCaseStepIndex('RESERVED')).toBe(2);
    expect(getCaseStepIndex('APPROVED_NO_DATES')).toBe(3);
    expect(getCaseStepIndex('READY_FOR_EXECUTION')).toBe(3);
    expect(getCaseStepIndex('IN_PROGRESS')).toBe(4);
    expect(getCaseStepIndex('AWAITING_BILLING')).toBe(5);
    expect(getCaseStepIndex('PAID')).toBe(6);
  });

  it('returns -1 for statuses off the stepper', () => {
    expect(getCaseStepIndex('CANCELLED')).toBe(-1);
  });

  it('falls back to a best-effort index for legacy statuses', () => {
    expect(getCaseStepIndex('DRAFT')).toBe(0);
    expect(getCaseStepIndex('COMPLETED')).toBe(6);
  });
});

describe('getCaseNextAction', () => {
  it('recommends scheduling work when dates are missing', () => {
    const action = getCaseNextAction('APPROVED_NO_DATES');
    expect(action).not.toBeNull();
    expect(action?.tab).toBe('jobs');
  });

  it('points to quotations while awaiting approval', () => {
    expect(getCaseNextAction('AWAITING_APPROVAL')?.tab).toBe('quotations');
  });

  it('returns null when the project is paid or cancelled', () => {
    expect(getCaseNextAction('PAID')).toBeNull();
    expect(getCaseNextAction('CANCELLED')).toBeNull();
  });
});
