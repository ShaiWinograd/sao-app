// Worker monthly-report status presentation.
//
// Worker payment tracking was removed (product refactor spec §1.2 — no "paid"
// status, payment date, method, or amount-paid tracking). The `PAID` value of
// the Prisma `WorkerReportStatus` enum, and the `WorkerMonthlyReport.paidAt`
// column, are RETAINED in the database for backward compatibility with historical
// rows only, but they are DEPRECATED: no new report ever produces them and no
// UI exposes a payment action or a paid status.
//
// @deprecated `WorkerReportStatus.PAID` — retained for historical rows only.
// @deprecated `WorkerMonthlyReport.paidAt` — no longer read or written.

/** Statuses kept only for legacy/historical rows; never produced by new logic. */
export const DEPRECATED_WORKER_REPORT_STATUSES = ['PAID'] as const;

/**
 * Map a stored worker-report status to the status shown to owners and workers.
 * A historical `PAID` report is presented as a finalized, worker-approved (read
 * only) report, so payment state is never surfaced. All other statuses pass
 * through unchanged; a missing status defaults to `DRAFT`.
 */
export function presentWorkerReportStatus(status: string | null | undefined): string {
  if (!status) return 'DRAFT';
  return status === 'PAID' ? 'WORKER_APPROVED' : status;
}
