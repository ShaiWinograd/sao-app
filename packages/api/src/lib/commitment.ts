import { Prisma } from '@prisma/client';
import {
  findCommitmentConflict,
  COMMITMENT_CONFLICT_MESSAGES,
  type CommitmentConflict,
  type CommitmentStatus,
} from '@workforce/shared';
import { isUnavailableOn } from '@workforce/shared';

// Thrown by the shared same-day commitment guard. The global Fastify error
// handler maps it to a 409 so every flow that calls the guard inside its write
// transaction rejects atomically (the transaction rolls back).
export class CommitmentConflictError extends Error {
  code: CommitmentConflict['code'];
  constructor(conflict: CommitmentConflict) {
    super(COMMITMENT_CONFLICT_MESSAGES[conflict.code]);
    this.name = 'CommitmentConflictError';
    this.code = conflict.code;
  }
}

// Per-worker / per-job transaction advisory locks. Serialize concurrent
// commitment/capacity operations at the database level so no two transactions
// can create a duplicate same-day commitment or over-fill a slot. Namespaces:
// 1 = worker, 2 = job.
export async function lockWorker(tx: Prisma.TransactionClient, workerId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(1, hashtext(${workerId}))`;
}

export async function lockJob(tx: Prisma.TransactionClient, jobId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(2, hashtext(${jobId}))`;
}

export async function lockCase(tx: Prisma.TransactionClient, caseId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, hashtext(${caseId}))`;
}

// Serialize concurrent submissions carrying the same idempotency key so a
// double-submit / retry cannot create two jobs even without a DB unique index.
export async function lockIdempotencyKey(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4, hashtext(${key}))`;
}

const BLOCKING_STATUSES: CommitmentStatus[] = ['PENDING', 'AWAITING_WORKER', 'APPROVED'];

/**
 * THE single same-day commitment guard (§12.1, §13, clarification #13). Every
 * flow that can reserve or assign a worker to a calendar date must call this
 * inside the same transaction that writes the new state. It:
 *   1. takes a per-worker advisory lock (serializes concurrent commitment ops);
 *   2. reads the worker's shifts / availability / pending swaps for that date;
 *   3. applies the shared rule (findCommitmentConflict);
 *   4. throws CommitmentConflictError (→ 409, tx rollback) when blocked.
 *
 * A full calendar date is blocked regardless of shift hours.
 */
export async function assertWorkerFreeOnDate(
  tx: Prisma.TransactionClient,
  workerId: string,
  jobDate: Date,
  opts: { ignoreShiftId?: string; ignoreSwapId?: string } = {},
): Promise<void> {
  await lockWorker(tx, workerId);

  const dateKey = jobDate.toISOString().slice(0, 10);

  const shifts = await tx.shift.findMany({
    where: {
      workerId,
      joinRequestStatus: { in: BLOCKING_STATUSES },
      job: { date: jobDate },
    },
    select: { id: true, joinRequestStatus: true },
  });

  const availability = await tx.workerAvailability.findMany({ where: { workerId } });
  const isUnavailable = isUnavailableOn(
    availability.map((b) => ({
      type: b.type,
      startDate: b.startDate ? b.startDate.toISOString() : null,
      endDate: b.endDate ? b.endDate.toISOString() : null,
      weekday: b.weekday,
    })),
    dateKey,
  );

  const swaps = await tx.shiftSwap.findMany({
    where: {
      status: { in: ['PENDING_WORKER', 'PENDING_OWNER'] },
      OR: [
        { fromWorkerId: workerId, toShift: { job: { date: jobDate } } },
        { toWorkerId: workerId, fromShift: { job: { date: jobDate } } },
      ],
    },
    select: { id: true },
  });

  const conflict = findCommitmentConflict(dateKey, {
    shifts: shifts.map((s) => ({ id: s.id, dateKey, joinRequestStatus: s.joinRequestStatus as CommitmentStatus })),
    isUnavailable,
    pendingSwapTargets: swaps.map((s) => ({ swapId: s.id, workerLandsOnDateKey: dateKey })),
    ignoreShiftId: opts.ignoreShiftId,
    ignoreSwapId: opts.ignoreSwapId,
  });

  if (conflict) throw new CommitmentConflictError(conflict);
}
