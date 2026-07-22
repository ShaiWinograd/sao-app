import { describe, expect, it } from 'vitest';
import { presentWorkerReportStatus, DEPRECATED_WORKER_REPORT_STATUSES } from './worker-report-status';

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
