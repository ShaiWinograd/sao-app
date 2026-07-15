import { Prisma } from '@prisma/client';
import { computeApprovedScheduleStatus } from '@workforce/shared';

// Statuses at/after execution start — a quote (re)approval must not drag these
// back to the scheduling phase.
const POST_SCHEDULE_STATUSES = new Set([
  'IN_PROGRESS',
  'AWAITING_COMPLETION',
  'AWAITING_BILLING',
  'AWAITING_PAYMENT',
  'PAID',
  'CANCELLED',
]);

// The three scheduling statuses that are auto-derived from planned vs scheduled work.
const SCHEDULE_FAMILY = new Set([
  'APPROVED_NO_DATES',
  'PARTIALLY_SCHEDULED',
  'READY_FOR_EXECUTION',
]);

async function deriveScheduleStatus(tx: Prisma.TransactionClient, caseId: string) {
  const [planned, jobs] = await Promise.all([
    tx.plannedServiceComponent.findMany({ where: { caseId }, select: { serviceType: true } }),
    tx.job.findMany({ where: { caseId, status: { not: 'CANCELLED' } }, select: { jobType: true } }),
  ]);
  return computeApprovedScheduleStatus(
    planned.map((p) => p.serviceType),
    jobs.map((j) => j.jobType),
  );
}

/**
 * Called when a quotation is approved. Moves the case into the approved-schedule
 * family (APPROVED_NO_DATES / PARTIALLY_SCHEDULED / READY_FOR_EXECUTION) based on
 * how much work is already scheduled. No-op if the case has progressed past
 * scheduling or was cancelled.
 */
export async function applyQuoteApprovalStatus(tx: Prisma.TransactionClient, caseId: string): Promise<void> {
  const kase = await tx.customerCase.findUnique({ where: { id: caseId }, select: { status: true } });
  if (!kase || POST_SCHEDULE_STATUSES.has(kase.status)) return;
  const next = await deriveScheduleStatus(tx, caseId);
  if (next !== kase.status) {
    await tx.customerCase.update({ where: { id: caseId }, data: { status: next } });
  }
}

/**
 * Called when jobs are created or cancelled. Re-derives the scheduling status,
 * but only while the case is still in the scheduling family so we never override
 * a manual/further transition (e.g. IN_PROGRESS).
 */
export async function refreshScheduleStatus(tx: Prisma.TransactionClient, caseId: string): Promise<void> {
  const kase = await tx.customerCase.findUnique({ where: { id: caseId }, select: { status: true } });
  if (!kase || !SCHEDULE_FAMILY.has(kase.status)) return;
  const next = await deriveScheduleStatus(tx, caseId);
  if (next !== kase.status) {
    await tx.customerCase.update({ where: { id: caseId }, data: { status: next } });
  }
}
