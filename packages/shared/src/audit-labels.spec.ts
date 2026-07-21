import { describe, expect, it } from 'vitest';
import { auditReasonLabel, AUDIT_REASON_FALLBACK, AUDIT_REASON_LABELS } from './audit-labels';

describe('auditReasonLabel', () => {
  it('maps the raw codes the owner reported as readable Hebrew', () => {
    expect(auditReasonLabel('quick-created')).toBe('העבודה נוצרה');
    expect(auditReasonLabel('join-request')).toBe('העובדת ביקשה להצטרף');
    expect(auditReasonLabel('approved')).toBe('בקשת ההצטרפות אושרה');
    expect(auditReasonLabel('manual-complete:worked')).toBe('העובדת סומנה כמי שעבדה');
    expect(auditReasonLabel('manual-complete')).toBe('העבודה סומנה כבוצעה');
    expect(auditReasonLabel('customer-report:finalized')).toBe('דוח הלקוחה הופק');
    expect(auditReasonLabel('customer-report:corrected')).toBe('נוצרה גרסה מתוקנת לדוח');
  });

  it('never returns the raw internal code', () => {
    for (const key of Object.keys(AUDIT_REASON_LABELS)) {
      const label = auditReasonLabel(key);
      expect(label).toBe(AUDIT_REASON_LABELS[key]);
      expect(label).not.toBe(key); // no raw identifier leaks
      expect(/[a-z]/.test(label)).toBe(false); // Hebrew label, no latin code
    }
  });

  it('uses a safe Hebrew fallback for unknown or missing codes', () => {
    expect(auditReasonLabel('some-new-internal-code')).toBe(AUDIT_REASON_FALLBACK);
    expect(auditReasonLabel('')).toBe(AUDIT_REASON_FALLBACK);
    expect(auditReasonLabel(null)).toBe(AUDIT_REASON_FALLBACK);
    expect(auditReasonLabel(undefined)).toBe(AUDIT_REASON_FALLBACK);
    expect(/[a-z]/i.test(AUDIT_REASON_FALLBACK)).toBe(false);
  });
});
