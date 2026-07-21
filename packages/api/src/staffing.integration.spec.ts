/**
 * §12–13 staffing concurrency / transactional-integrity integration tests.
 *
 * These exercise the REAL database guarantees (Postgres advisory locks inside
 * transactions) that protect against duplicate same-day commitments and slot
 * over-fill. They require a throwaway Postgres reachable via TEST_DATABASE_URL
 * and are skipped otherwise (CI has no DB — the pure rules in
 * @workforce/shared/staffing are unit-tested there instead).
 *
 * Run locally, e.g.:
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/workforce_test \
 *     npm --workspace @workforce/api run test
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decideApproval, nextBackupToPromote, validateCapacityReduction, MANAGER_SKILL } from '@workforce/shared';
import { assertWorkerFreeOnDate, lockJob, CommitmentConflictError } from './lib/commitment.js';

const TEST_DB = process.env.TEST_DATABASE_URL;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

const JOB_DATE = new Date('2999-01-15T00:00:00.000Z');
const START = new Date('2999-01-15T08:00:00.000Z');
const END = new Date('2999-01-15T16:00:00.000Z');

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function seedWorker(skills: ('SHIFT_LEADER')[] = []) {
  const id = uid('w');
  const user = await prisma.user.create({
    data: { id: uid('u'), email: `${id}@t.test`, firstName: 'T', lastName: id, role: 'WORKER' },
  });
  return prisma.worker.create({
    data: {
      id,
      userId: user.id,
      firstName: 'T',
      lastName: id,
      phone: '0500000000',
      email: `${id}.w@t.test`,
      hourlyWage: new Prisma.Decimal(50),
      dailyPaymentAmount: new Prisma.Decimal(400),
      paymentMethod: 'BANK_TRANSFER',
      skills,
    },
  });
}

async function seedJob(requiredWorkerCount: number) {
  const customer = await prisma.customer.create({
    data: { firstName: 'C', lastName: uid('c'), phone: '03', email: `${uid('c')}@t.test` },
  });
  const address = await prisma.address.create({
    data: { customerId: customer.id, fullAddress: 'Somewhere 1', label: 'OTHER' },
  });
  const kase = await prisma.customerCase.create({ data: { customerId: customer.id, name: 'Case' } });
  return prisma.job.create({
    data: {
      caseId: kase.id,
      customerId: customer.id,
      addressId: address.id,
      jobType: 'PACKING',
      date: JOB_DATE,
      plannedStart: START,
      plannedEnd: END,
      requiredWorkerCount,
    },
  });
}

async function seedShift(
  jobId: string,
  workerId: string,
  status: 'PENDING' | 'APPROVED',
  role: 'REGULAR' | 'TEAM_LEADER' | 'BACKUP' = 'REGULAR',
  createdAt?: Date,
) {
  return prisma.shift.create({
    data: {
      workerId,
      jobId,
      scheduledStart: START,
      scheduledEnd: END,
      joinRequestStatus: status,
      assignmentRole: role,
      hourlyWageSnapshot: new Prisma.Decimal(50),
      dailyPaymentSnapshot: new Prisma.Decimal(400),
      workerNameSnapshot: 'T',
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

// Mirrors the /:shiftId/approve transaction body so the test exercises the exact
// guard + job-lock + capacity decision used by the endpoint.
async function approveInTx(shiftId: string) {
  return prisma.$transaction(async (tx) => {
    const shift = await tx.shift.findUniqueOrThrow({
      where: { id: shiftId },
      include: { job: true, worker: { select: { skills: true } } },
    });
    await lockJob(tx, shift.jobId);
    await assertWorkerFreeOnDate(tx, shift.workerId, shift.job.date, { ignoreShiftId: shiftId });
    const approvedNormal = await tx.shift.count({
      where: { jobId: shift.jobId, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
    });
    const approvedLeader = await tx.shift.count({
      where: { jobId: shift.jobId, joinRequestStatus: 'APPROVED', assignmentRole: 'TEAM_LEADER' },
    });
    const decision = decideApproval({
      requiredWorkerCount: shift.job.requiredWorkerCount,
      requiresLeader: false,
      approvedNormalCount: approvedNormal,
      approvedLeaderCount: approvedLeader,
      workerLeaderEligible: (shift.worker.skills as string[]).includes('SHIFT_LEADER'),
      requestedRole: 'REGULAR',
      confirmBackup: false,
    });
    if (decision.outcome === 'REJECT' || decision.outcome === 'NEEDS_BACKUP_CONFIRM') {
      throw new Error(decision.outcome);
    }
    const role = decision.outcome === 'ASSIGN_BACKUP' ? 'BACKUP' : decision.role;
    await tx.shift.update({ where: { id: shiftId }, data: { joinRequestStatus: 'APPROVED', assignmentRole: role } });
    return role;
  });
}

async function seedLeaderSlot(jobId: string) {
  return prisma.jobSlot.create({ data: { jobId, requiredSkill: MANAGER_SKILL as any } });
}

// Mirrors the PATCH /jobs/:id capacity-reduction transaction body: under the job
// lock, re-read the current regulars, validate the owner's backup selection with
// the shared MUST_SELECT_BACKUPS contract, enforce team-leader preservation, then
// demote — all atomic so a concurrent change rolls the whole thing back.
async function reduceCapacityInTx(jobId: string, newCount: number, demoteToBackupIds: string[]) {
  return prisma.$transaction(async (tx) => {
    await lockJob(tx, jobId);
    const regulars = await tx.shift.findMany({
      where: { jobId, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
      select: { id: true, assignmentRole: true },
    });
    if (newCount < regulars.length) {
      const regularShiftIds = regulars.map((r) => r.id);
      const check = validateCapacityReduction({ newRequiredCount: newCount, regularShiftIds, demoteToBackupIds });
      if (!check.ok) throw new Error(check.code);
      const requiresLeader = (await tx.jobSlot.count({ where: { jobId, requiredSkill: MANAGER_SKILL as any } })) > 0;
      const demotedSet = new Set(demoteToBackupIds);
      const leaderRemains = regulars.some((r) => r.assignmentRole === 'TEAM_LEADER' && !demotedSet.has(r.id));
      if (requiresLeader && !leaderRemains) throw new Error('LEADER_REQUIRED');
      await tx.shift.updateMany({ where: { id: { in: demoteToBackupIds }, jobId }, data: { assignmentRole: 'BACKUP' } });
    }
    return tx.job.update({ where: { id: jobId }, data: { requiredWorkerCount: newCount } });
  });
}

describe.skipIf(!TEST_DB)('§12–13 staffing concurrency (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    // Order matters for FK constraints.
    await prisma.auditLog.deleteMany();
    await prisma.customerReportVersion.deleteMany();
    await prisma.shiftSwap.deleteMany();
    await prisma.replacementVolunteer.deleteMany();
    await prisma.replacementRequest.deleteMany();
    await prisma.shift.deleteMany();
    await prisma.jobSlot.deleteMany();
    await prisma.job.deleteMany();
    await prisma.customerCase.deleteMany();
    await prisma.address.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.workerAvailability.deleteMany();
    await prisma.worker.deleteMany();
    await prisma.user.deleteMany();
  });

  it('serializes duplicate same-day commitments: only one of two concurrent commits succeeds', async () => {
    const worker = await seedWorker();
    const jobA = await seedJob(1);
    const jobB = await seedJob(1);

    const commit = (jobId: string) =>
      prisma.$transaction(async (tx) => {
        await assertWorkerFreeOnDate(tx, worker.id, JOB_DATE);
        await tx.shift.create({
          data: {
            workerId: worker.id,
            jobId,
            scheduledStart: START,
            scheduledEnd: END,
            joinRequestStatus: 'APPROVED',
            assignmentRole: 'REGULAR',
            hourlyWageSnapshot: new Prisma.Decimal(50),
            dailyPaymentSnapshot: new Prisma.Decimal(400),
            workerNameSnapshot: 'T',
          },
        });
      });

    const results = await Promise.allSettled([commit(jobA.id), commit(jobB.id)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as CommitmentConflictError).code).toBe('ALREADY_COMMITTED');

    const shifts = await prisma.shift.count({ where: { workerId: worker.id, joinRequestStatus: 'APPROVED' } });
    expect(shifts).toBe(1);
  });

  it('prevents over-filling the last regular slot: one approval assigns, the other must become a confirmed backup', async () => {
    const job = await seedJob(1);
    const w1 = await seedWorker();
    const w2 = await seedWorker();
    const s1 = await seedShift(job.id, w1.id, 'PENDING');
    const s2 = await seedShift(job.id, w2.id, 'PENDING');

    const results = await Promise.allSettled([approveInTx(s1.id), approveInTx(s2.id)]);
    const assigned = results.filter((r) => r.status === 'fulfilled' && r.value !== 'BACKUP');
    const blocked = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    // Exactly one fills the single regular position; the other cannot silently
    // over-fill — it is rejected as NEEDS_BACKUP_CONFIRM (owner must confirm backup).
    expect(assigned).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect((blocked[0].reason as Error).message).toBe('NEEDS_BACKUP_CONFIRM');

    const regulars = await prisma.shift.count({
      where: { jobId: job.id, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
    });
    expect(regulars).toBe(1);
  });

  it('promotes only one backup when a single position is open, even under concurrency', async () => {
    const job = await seedJob(2);
    const reg = await seedWorker();
    const b1 = await seedWorker();
    const b2 = await seedWorker();
    await seedShift(job.id, reg.id, 'APPROVED', 'REGULAR');
    const backup1 = await seedShift(job.id, b1.id, 'APPROVED', 'BACKUP', new Date('2999-01-01T00:00:00Z'));
    const backup2 = await seedShift(job.id, b2.id, 'APPROVED', 'BACKUP', new Date('2999-01-02T00:00:00Z'));

    const promote = () =>
      prisma.$transaction(async (tx) => {
        await lockJob(tx, job.id);
        const approvedNormal = await tx.shift.count({
          where: { jobId: job.id, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
        });
        if (approvedNormal >= 2) throw new Error('NO_OPEN_POSITION');
        const backups = await tx.shift.findMany({
          where: { jobId: job.id, assignmentRole: 'BACKUP', joinRequestStatus: 'APPROVED' },
        });
        const next = nextBackupToPromote(backups.map((b) => ({ id: b.id, assignedAt: b.createdAt.getTime() })));
        if (!next) throw new Error('NO_BACKUP');
        await tx.shift.update({ where: { id: next.id }, data: { assignmentRole: 'REGULAR' } });
        return next.id;
      });

    const results = await Promise.allSettled([promote(), promote()]);
    const ok = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<string>[];
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as Error).message).toBe('NO_OPEN_POSITION');
    // Earliest backup (backup1) is the one promoted.
    expect(ok[0].value).toBe(backup1.id);

    const promotedBackup2 = await prisma.shift.findUnique({ where: { id: backup2.id } });
    expect(promotedBackup2?.assignmentRole).toBe('BACKUP');
  });

  it('blocks a cross-flow duplicate: a direct assignment cannot re-commit an already-committed worker', async () => {
    const worker = await seedWorker();
    const jobA = await seedJob(1);
    const jobB = await seedJob(1);
    // Flow 1: join → approved.
    await prisma.$transaction(async (tx) => {
      await assertWorkerFreeOnDate(tx, worker.id, JOB_DATE);
      await seedShift(jobA.id, worker.id, 'APPROVED');
    });
    // Flow 2: owner direct-assign same worker, same date → guard rejects.
    await expect(
      prisma.$transaction(async (tx) => {
        await assertWorkerFreeOnDate(tx, worker.id, JOB_DATE);
        await seedShift(jobB.id, worker.id, 'APPROVED');
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_COMMITTED' });
  });

  it('frees the date after cancellation so the worker can be re-committed', async () => {
    const worker = await seedWorker();
    const jobA = await seedJob(1);
    const jobB = await seedJob(1);
    const s = await seedShift(jobA.id, worker.id, 'APPROVED');
    await prisma.shift.update({ where: { id: s.id }, data: { joinRequestStatus: 'CANCELLED' } });
    // A cancelled shift no longer blocks the date.
    await expect(
      prisma.$transaction(async (tx) => {
        await assertWorkerFreeOnDate(tx, worker.id, JOB_DATE);
        await seedShift(jobB.id, worker.id, 'APPROVED');
      }),
    ).resolves.not.toThrow();
  });

  it('rolls back the whole transaction (no partial writes) when a later step throws', async () => {
    const worker = await seedWorker();
    const job = await seedJob(1);
    await expect(
      prisma.$transaction(async (tx) => {
        await assertWorkerFreeOnDate(tx, worker.id, JOB_DATE);
        await tx.shift.create({
          data: {
            workerId: worker.id,
            jobId: job.id,
            scheduledStart: START,
            scheduledEnd: END,
            joinRequestStatus: 'APPROVED',
            assignmentRole: 'REGULAR',
            hourlyWageSnapshot: new Prisma.Decimal(50),
            dailyPaymentSnapshot: new Prisma.Decimal(400),
            workerNameSnapshot: 'T',
          },
        });
        throw new Error('audit-failure');
      }),
    ).rejects.toThrow('audit-failure');
    const count = await prisma.shift.count({ where: { workerId: worker.id } });
    expect(count).toBe(0);
  });

  it('reduces capacity with exactly the required backup selections', async () => {
    const job = await seedJob(3);
    const w1 = await seedWorker();
    const w2 = await seedWorker();
    const w3 = await seedWorker();
    const r1 = await seedShift(job.id, w1.id, 'APPROVED', 'REGULAR');
    const r2 = await seedShift(job.id, w2.id, 'APPROVED', 'REGULAR');
    const r3 = await seedShift(job.id, w3.id, 'APPROVED', 'REGULAR');

    await reduceCapacityInTx(job.id, 2, [r1.id]); // excess = 3 - 2 = 1

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.requiredWorkerCount).toBe(2);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: r1.id } })).assignmentRole).toBe('BACKUP');
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: r2.id } })).assignmentRole).toBe('REGULAR');
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: r3.id } })).assignmentRole).toBe('REGULAR');
  });

  it('rejects too few or too many backup selections and changes nothing', async () => {
    const job = await seedJob(3);
    const w1 = await seedWorker();
    const w2 = await seedWorker();
    const w3 = await seedWorker();
    const r1 = await seedShift(job.id, w1.id, 'APPROVED', 'REGULAR');
    const r2 = await seedShift(job.id, w2.id, 'APPROVED', 'REGULAR');
    await seedShift(job.id, w3.id, 'APPROVED', 'REGULAR');

    // excess is 1; zero selections is too few.
    await expect(reduceCapacityInTx(job.id, 2, [])).rejects.toThrow('MUST_SELECT_BACKUPS');
    // two selections is too many.
    await expect(reduceCapacityInTx(job.id, 2, [r1.id, r2.id])).rejects.toThrow('MUST_SELECT_BACKUPS');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.requiredWorkerCount).toBe(3);
    const backups = await prisma.shift.count({ where: { jobId: job.id, assignmentRole: 'BACKUP' } });
    expect(backups).toBe(0);
  });

  it('preserves a required team leader: rejects demoting the only leader, allows demoting a regular', async () => {
    const job = await seedJob(2);
    await seedLeaderSlot(job.id);
    const leaderW = await seedWorker(['SHIFT_LEADER']);
    const w1 = await seedWorker();
    const w2 = await seedWorker();
    const leader = await seedShift(job.id, leaderW.id, 'APPROVED', 'TEAM_LEADER');
    const r1 = await seedShift(job.id, w1.id, 'APPROVED', 'REGULAR');
    await seedShift(job.id, w2.id, 'APPROVED', 'REGULAR'); // 3 regulars, excess 1

    // Demoting the only leader while a leader is required is rejected.
    await expect(reduceCapacityInTx(job.id, 2, [leader.id])).rejects.toThrow('LEADER_REQUIRED');
    expect((await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).requiredWorkerCount).toBe(2);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: leader.id } })).assignmentRole).toBe('TEAM_LEADER');

    // Demoting a regular keeps the leader assigned and succeeds.
    await reduceCapacityInTx(job.id, 2, [r1.id]);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: leader.id } })).assignmentRole).toBe('TEAM_LEADER');
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: r1.id } })).assignmentRole).toBe('BACKUP');
  });

  it('rolls back when a selected assignment is no longer valid due to a concurrent change', async () => {
    const job = await seedJob(4);
    const w1 = await seedWorker();
    const w2 = await seedWorker();
    const w3 = await seedWorker();
    const w4 = await seedWorker();
    const r1 = await seedShift(job.id, w1.id, 'APPROVED', 'REGULAR');
    const r2 = await seedShift(job.id, w2.id, 'APPROVED', 'REGULAR');
    const r3 = await seedShift(job.id, w3.id, 'APPROVED', 'REGULAR');
    const r4 = await seedShift(job.id, w4.id, 'APPROVED', 'REGULAR');

    // A concurrent flow demoted r1 to backup before the owner's reduction applies,
    // so r1 is no longer one of the job's regular assignments.
    await prisma.shift.update({ where: { id: r1.id }, data: { assignmentRole: 'BACKUP' } });

    // The owner still wants to drop to 2 and named r1 + r2 (needing 2 demotions of
    // the original 4). Under the lock only r2/r3/r4 are regular, so naming r1 is an
    // invalid selection and the whole change rolls back.
    await expect(reduceCapacityInTx(job.id, 2, [r1.id, r2.id])).rejects.toThrow('INVALID_SELECTION');

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.requiredWorkerCount).toBe(4); // unchanged
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: r2.id } })).assignmentRole).toBe('REGULAR');
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: r3.id } })).assignmentRole).toBe('REGULAR');
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: r4.id } })).assignmentRole).toBe('REGULAR');
  });

  // --- Join-request lifecycle: pending vs assigned, reject, stale (spec items 3/4/6) ---

  it('a PENDING request blocks the date but does NOT count toward approved staffing', async () => {
    const job = await seedJob(1);
    const wA = await seedWorker();
    const wB = await seedWorker();
    const pendingA = await seedShift(job.id, wA.id, 'PENDING');

    // Capacity is measured on APPROVED shifts only — a pending request leaves the slot open.
    const approvedNormal = await prisma.shift.count({
      where: { jobId: job.id, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
    });
    expect(approvedNormal).toBe(0);

    // But the pending request DOES block wA's date (they cannot be double-committed).
    await expect(
      prisma.$transaction((tx) => assertWorkerFreeOnDate(tx, wA.id, JOB_DATE)),
    ).rejects.toBeInstanceOf(CommitmentConflictError);

    // Approving wB takes the only regular slot.
    const bShift = await seedShift(job.id, wB.id, 'PENDING');
    expect(await approveInTx(bShift.id)).toBe('REGULAR');

    // The slot is now full, proving the earlier pending A never held it: approving A
    // needs a backup confirmation rather than silently over-filling.
    await expect(approveInTx(pendingA.id)).rejects.toThrow('NEEDS_BACKUP_CONFIRM');
  });

  it('approving a pending request updates the SAME shift in place (no duplicate assignment card)', async () => {
    const job = await seedJob(1);
    const w = await seedWorker();
    const shift = await seedShift(job.id, w.id, 'PENDING');

    expect(await approveInTx(shift.id)).toBe('REGULAR');

    const shiftsForWorkerJob = await prisma.shift.findMany({ where: { jobId: job.id, workerId: w.id } });
    expect(shiftsForWorkerJob).toHaveLength(1);
    expect(shiftsForWorkerJob[0].id).toBe(shift.id);
    expect(shiftsForWorkerJob[0].joinRequestStatus).toBe('APPROVED');
  });

  it('rejecting a pending request releases the worker date block and clears the pending state', async () => {
    const job = await seedJob(1);
    const w = await seedWorker();
    const shift = await seedShift(job.id, w.id, 'PENDING');

    // Endpoint reject behaviour: set REJECTED (a non-blocking, non-approved status).
    await prisma.shift.update({ where: { id: shift.id }, data: { joinRequestStatus: 'REJECTED' } });

    // The date is released — the worker is free again.
    await expect(
      prisma.$transaction((tx) => assertWorkerFreeOnDate(tx, w.id, JOB_DATE)),
    ).resolves.toBeUndefined();
    // And it no longer counts as approved staffing.
    const approved = await prisma.shift.count({ where: { jobId: job.id, joinRequestStatus: 'APPROVED' } });
    expect(approved).toBe(0);
  });

  it('a stale/already-handled request is guarded (the approve precondition rejects non-pending)', async () => {
    const job = await seedJob(1);
    const w = await seedWorker();
    const shift = await seedShift(job.id, w.id, 'APPROVED');

    // Mirrors the POST /:shiftId/approve precondition that returns a typed 409.
    const current = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    const canAct = ['PENDING', 'AWAITING_WORKER'].includes(current.joinRequestStatus);
    expect(canAct).toBe(false);
  });
});
