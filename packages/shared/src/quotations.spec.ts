import { describe, expect, it } from 'vitest';
import {
  canEditQuotationVersion,
  deriveApprovedSchedulingStatus,
  getCurrentQuotationVersion,
  isQuotationExpired,
  nextQuotationVersionNumber,
  type QuotationVersionLike,
} from './quotations';

describe('canEditQuotationVersion', () => {
  it('allows editing only draft versions', () => {
    expect(canEditQuotationVersion('DRAFT')).toBe(true);
  });

  it('blocks editing sent, approved, rejected, and expired versions', () => {
    expect(canEditQuotationVersion('SENT')).toBe(false);
    expect(canEditQuotationVersion('APPROVED')).toBe(false);
    expect(canEditQuotationVersion('REJECTED')).toBe(false);
    expect(canEditQuotationVersion('EXPIRED')).toBe(false);
  });
});

describe('deriveApprovedSchedulingStatus', () => {
  it('is awaiting dates when nothing is scheduled', () => {
    expect(deriveApprovedSchedulingStatus({ scheduledRequiredJobs: 0, totalRequiredJobs: 3 })).toBe(
      'APPROVED_AWAITING_DATES',
    );
  });

  it('is awaiting dates when there is no required work yet', () => {
    expect(deriveApprovedSchedulingStatus({ scheduledRequiredJobs: 0, totalRequiredJobs: 0 })).toBe(
      'APPROVED_AWAITING_DATES',
    );
  });

  it('is partial when some but not all required work is scheduled', () => {
    expect(deriveApprovedSchedulingStatus({ scheduledRequiredJobs: 1, totalRequiredJobs: 3 })).toBe(
      'APPROVED_PARTIAL_SCHEDULING',
    );
  });

  it('is ready when all required work is scheduled', () => {
    expect(deriveApprovedSchedulingStatus({ scheduledRequiredJobs: 3, totalRequiredJobs: 3 })).toBe(
      'APPROVED_READY',
    );
  });
});

describe('getCurrentQuotationVersion', () => {
  it('returns undefined for no versions', () => {
    expect(getCurrentQuotationVersion([])).toBeUndefined();
  });

  it('returns the version with the highest version number', () => {
    const versions: QuotationVersionLike[] = [
      { versionNumber: 1, status: 'REJECTED' },
      { versionNumber: 3, status: 'DRAFT' },
      { versionNumber: 2, status: 'SENT' },
    ];
    expect(getCurrentQuotationVersion(versions)?.versionNumber).toBe(3);
  });
});

describe('nextQuotationVersionNumber', () => {
  it('starts at 1 with no versions', () => {
    expect(nextQuotationVersionNumber([])).toBe(1);
  });

  it('increments from the current version', () => {
    expect(
      nextQuotationVersionNumber([
        { versionNumber: 1, status: 'APPROVED' },
        { versionNumber: 2, status: 'DRAFT' },
      ]),
    ).toBe(3);
  });
});

describe('isQuotationExpired', () => {
  const now = new Date('2026-07-12T00:00:00Z');

  it('is not expired without a valid-until date', () => {
    expect(isQuotationExpired(null, now)).toBe(false);
  });

  it('is expired when valid-until is in the past', () => {
    expect(isQuotationExpired(new Date('2026-07-11T00:00:00Z'), now)).toBe(true);
  });

  it('is not expired when valid-until is in the future', () => {
    expect(isQuotationExpired(new Date('2026-07-13T00:00:00Z'), now)).toBe(false);
  });
});
