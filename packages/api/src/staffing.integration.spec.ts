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
import { decideApproval, nextBackupToPromote } from '@workforce/shared';
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

describe.skipIf(!TEST_DB)('§12–13 staffing concurrency (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    // Order matters for FK constraints.
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
});
