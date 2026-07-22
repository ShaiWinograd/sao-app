import { prisma } from './prisma.js';

// The current (highest-version) published monthly report for a worker/month.
export async function latestWorkerReport(workerId: string, month: number, year: number) {
  return prisma.workerMonthlyReport.findFirst({
    where: { workerId, month, year },
    orderBy: { version: 'desc' },
  });
}

// Flag the current published report as needing a new version after underlying
// data changed (spec §24.3). Finalized snapshots stay immutable.
//
// NOTE: `WorkerReportStatus.PAID` and `WorkerMonthlyReport.paidAt` are DEPRECATED
// and retained only for historical rows (worker payment tracking was removed,
// spec §1.2). No code produces them; `PAID` is deliberately excluded below so a
// historical paid report is never re-opened, and it is presented as a finalized
// worker-approved report via `presentWorkerReportStatus`.
export async function flagWorkerReportStale(workerId: string, month: number, year: number): Promise<boolean> {
  const latest = await latestWorkerReport(workerId, month, year);
  if (latest && ['PUBLISHED', 'REVISED', 'WORKER_APPROVED'].includes(latest.status)) {
    await prisma.workerMonthlyReport.update({
      where: { id: latest.id },
      data: { status: 'CORRECTION_REQUESTED' },
    });
    return true;
  }
  return false;
}
