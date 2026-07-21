import { describe, expect, it } from 'vitest';
import { auditReasonLabel, formatAuditEvent, AUDIT_REASON_FALLBACK, AUDIT_REASON_LABELS } from './audit-labels';

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

describe('formatAuditEvent', () => {
  it('includes the worker name for a join request', () => {
    const text = formatAuditEvent({ reason: 'join-request', subjectName: 'נועה וינוגרד' });
    expect(text).toContain('נועה וינוגרד');
    expect(text).toBe('נועה וינוגרד ביקשה להצטרף לעבודה');
  });

  it('includes both owner and worker on an approval', () => {
    const text = formatAuditEvent({ reason: 'approved', actorName: 'שי וינוגרד', subjectName: 'נועה וינוגרד' });
    expect(text).toContain('שי וינוגרד');
    expect(text).toContain('נועה וינוגרד');
    expect(text).toBe('שי וינוגרד אישרה את בקשת ההצטרפות של נועה וינוגרד');
  });

  it('includes owner and affected worker on a manual completion', () => {
    const worked = formatAuditEvent({ reason: 'manual-complete:worked', actorName: 'שי וינוגרד', subjectName: 'נועה וינוגרד' });
    expect(worked).toContain('שי וינוגרד');
    expect(worked).toContain('נועה וינוגרד');
    expect(worked).toBe('שי וינוגרד סימנה שנועה וינוגרד עבדה');

    const job = formatAuditEvent({ reason: 'manual-complete', actorName: 'שי וינוגרד' });
    expect(job).toBe('שי וינוגרד סימנה את העבודה כבוצעה');
  });

  it('includes the owner on report finalization', () => {
    const text = formatAuditEvent({ reason: 'customer-report:finalized', actorName: 'שי וינוגרד' });
    expect(text).toContain('שי וינוגרד');
    expect(text).toBe('שי וינוגרד הפיקה את דוח הלקוחה');
  });

  it('uses the stored snapshot name for a deleted worker and a safe fallback when no name exists', () => {
    // A deleted worker still resolves to the durable snapshot name passed in.
    const snapshot = formatAuditEvent({ reason: 'approved', actorName: 'שי וינוגרד', subjectName: 'עובדת שנמחקה' });
    expect(snapshot).toBe('שי וינוגרד אישרה את בקשת ההצטרפות של עובדת שנמחקה');
    // With no resolvable subject the join request degrades to a safe, name-free sentence.
    const fallback = formatAuditEvent({ reason: 'join-request', subjectName: null });
    expect(fallback).toBe('בקשת הצטרפות נשלחה');
  });

  it('never exposes the raw event code for an unknown reason', () => {
    const text = formatAuditEvent({ reason: 'some-unknown-code', actorName: 'שי וינוגרד' });
    expect(text).not.toContain('some-unknown-code');
    expect(/[a-z]/i.test(text)).toBe(false);
    expect(text).toBe(AUDIT_REASON_FALLBACK);
  });
});
