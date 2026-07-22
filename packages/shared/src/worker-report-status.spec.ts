import { describe, expect, it } from 'vitest';
import { presentWorkerReportStatus, workerReportStatusLabel, DEPRECATED_WORKER_REPORT_STATUSES } from './worker-report-status';

describe('workerReportStatusLabel (clear worker-facing wording)', () => {
  it('uses non-technical Hebrew for each status, with no raw code or version suffix', () => {
    expect(workerReportStatusLabel('PUBLISHED')).toBe('ממתין לאישורך');
    expect(workerReportStatusLabel('REVISED')).toBe('גרסה מעודכנת ממתינה לאישורך');
    expect(workerReportStatusLabel('CORRECTION_REQUESTED')).toBe('נדרשת בדיקה');
    expect(workerReportStatusLabel('WORKER_APPROVED')).toBe('אושר');
  });

  it('maps a historical PAID report to the approved wording (no payment status)', () => {
    expect(workerReportStatusLabel('PAID')).toBe('אושר');
  });

  it('never exposes a raw status code or a "v"-version', () => {
    for (const s of ['PUBLISHED', 'REVISED', 'CORRECTION_REQUESTED', 'WORKER_APPROVED', 'PAID', 'DRAFT', 'weird']) {
      const label = workerReportStatusLabel(s);
      expect(label).not.toMatch(/[a-z]/i);
      expect(label).not.toMatch(/v\d/i);
    }
  });
});

describe('presentWorkerReportStatus', () => {
  it('maps a historical PAID report to a finalized worker-approved presentation', () => {
    expect(presentWorkerReportStatus('PAID')).toBe('WORKER_APPROVED');
  });

  it('never surfaces PAID as a status', () => {
    expect(presentWorkerReportStatus('PAID')).not.toBe('PAID');
  });

  it('passes through active statuses unchanged', () => {
    for (const s of ['DRAFT', 'PUBLISHED', 'REVISED', 'CORRECTION_REQUESTED', 'WORKER_APPROVED']) {
      expect(presentWorkerReportStatus(s)).toBe(s);
    }
  });

  it('defaults a missing status to DRAFT', () => {
    expect(presentWorkerReportStatus(null)).toBe('DRAFT');
    expect(presentWorkerReportStatus(undefined)).toBe('DRAFT');
    expect(presentWorkerReportStatus('')).toBe('DRAFT');
  });

  it('documents PAID as a deprecated, retained-only status', () => {
    expect(DEPRECATED_WORKER_REPORT_STATUSES).toContain('PAID');
  });
});
