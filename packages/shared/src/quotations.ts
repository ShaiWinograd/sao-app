export type QuotationStatus = 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export type QuotationApprovedSchedulingStatus =
  | 'APPROVED_AWAITING_DATES'
  | 'APPROVED_PARTIAL_SCHEDULING'
  | 'APPROVED_READY';

export type QuotationVersionLike = {
  versionNumber: number;
  status: QuotationStatus;
};

// Only draft versions may be edited in place. Sent, approved, rejected, and
// expired versions are immutable — changing scope requires a new version.
export function canEditQuotationVersion(status: QuotationStatus): boolean {
  return status === 'DRAFT';
}

// After approval, the operational status depends on how much required work has
// been scheduled. Mirrors business_app_ux_spec/05-quotations.md "Status behavior".
export function deriveApprovedSchedulingStatus(input: {
  scheduledRequiredJobs: number;
  totalRequiredJobs: number;
}): QuotationApprovedSchedulingStatus {
  const scheduled = Math.max(input.scheduledRequiredJobs, 0);
  const total = Math.max(input.totalRequiredJobs, 0);

  if (total === 0 || scheduled === 0) return 'APPROVED_AWAITING_DATES';
  if (scheduled >= total) return 'APPROVED_READY';
  return 'APPROVED_PARTIAL_SCHEDULING';
}

// The current version of a quotation is the one with the highest version number.
export function getCurrentQuotationVersion<T extends QuotationVersionLike>(
  versions: T[],
): T | undefined {
  if (versions.length === 0) return undefined;
  return versions.reduce((latest, version) =>
    version.versionNumber > latest.versionNumber ? version : latest,
  );
}

export function nextQuotationVersionNumber(versions: QuotationVersionLike[]): number {
  const current = getCurrentQuotationVersion(versions);
  return current ? current.versionNumber + 1 : 1;
}

export function isQuotationExpired(validUntil: Date | null | undefined, now: Date = new Date()): boolean {
  if (!validUntil) return false;
  return validUntil.getTime() < now.getTime();
}
