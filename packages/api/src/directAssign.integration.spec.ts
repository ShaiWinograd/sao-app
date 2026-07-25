/**
 * §12.4 direct-assignment capacity guard integration tests. Exercise the REAL
 * role/count reservation guard (approved + awaiting, slotId-independent) against a
 * throwaway Postgres via TEST_DATABASE_URL; skipped otherwise.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/workforce_test \
 *     npm --workspace @workforce/api run test
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertDirectAssignCapacity } from './domain/directAssign.js';
import { lockJob } from './lib/commitment.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;
const DATE = new Date('2999-05-01T00:00:00.000Z');

async function clean() {
  await prisma.customerReportVersion.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.formSubmission.deleteMany({});
  await prisma.locationCheck.deleteMany({});
  await prisma.attendanceCorrection.deleteMany({});
  await prisma.shiftSwap.deleteMany({});
  await prisma.replacementRequest.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.jobSlot.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.customerCase.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.customer.deleteMany({});
}

async function seedJob(requiredWorkerCount: number, opts: { requiresLeader?: boolean } = {}) {
  const customer = await prisma.customer.create({ data: { firstName: 'C', lastName: uid('c'), phone: '03' } });
  const kase = await prisma.customerCase.create({ data: { customerId: customer.id, name: 'Case', status: 'ACTIVE' } });
  const address = await prisma.address.create({ data: { customerId: customer.id, fullAddress: 'X', label: 'OTHER' } });
  const job = await prisma.job.create({
    data: { caseId: kase.id, customerId: customer.id, addressId: address.id, jobType: 'PACKING', date: DATE, plannedStart: DATE, plannedEnd: DATE, requiredWorkerCount, status: 'RESERVATION' },
  });
  if (opts.requiresLeader) {
    await prisma.jobSlot.create({ data: { jobId: job.id, requiredSkill: 'SHIFT_LEADER' } });
  }
  return job;
}

async function seedWorker() {
  const id = uid('w');
  const user = await prisma.user.create({ data: { id: uid('u'), email: `${id}@t.test`, firstName: 'T', lastName: id, role: 'WORKER' } });
  return prisma.worker.create({
    data: { id, userId: user.id, firstName: 'T', lastName: id, phone: '0500000000', email: `${id}.w@t.test`, hourlyWage: new Prisma.Decimal(50), dailyPaymentAmount: new Prisma.Decimal(400), paymentMethod: 'BANK_TRANSFER', skills: [] },
  });
}

async function addShift(jobId: string, status: string, role: string, slotId: string | null = null) {
  const worker = await seedWorker();
  return prisma.shift.create({
    data: { jobId, workerId: worker.id, slotId, scheduledStart: DATE, scheduledEnd: DATE, joinRequestStatus: status as any, assignmentRole: role as any, attendanceStatus: 'SCHEDULED', hourlyWageSnapshot: new Prisma.Decimal(50), dailyPaymentSnapshot: new Prisma.Decimal(400), workerNameSnapshot: 'T' },
  });
}

const guard = (job: { id: string; requiredWorkerCount: number }, role: 'REGULAR' | 'TEAM_LEADER' | 'BACKUP', workerLeaderEligible = true) =>
  prisma.$transaction((tx) => assertDirectAssignCapacity(tx, { jobId: job.id, requiredWorkerCount: job.requiredWorkerCount, role, workerLeaderEligible }));

// Mimics the admin-assign route critical section: lock the job, run the capacity
// guard, then create the shift — all in one transaction.
async function assignInTx(job: { id: string; requiredWorkerCount: number }, role: 'REGULAR' | 'TEAM_LEADER' | 'BACKUP', workerId: string) {
  return prisma.$transaction(async (tx) => {
    await lockJob(tx, job.id);
    await assertDirectAssignCapacity(tx, { jobId: job.id, requiredWorkerCount: job.requiredWorkerCount, role, workerLeaderEligible: true });
    await tx.shift.create({
      data: { jobId: job.id, workerId, scheduledStart: DATE, scheduledEnd: DATE, joinRequestStatus: 'AWAITING_WORKER', assignmentRole: role as any, attendanceStatus: 'SCHEDULED', hourlyWageSnapshot: new Prisma.Decimal(50), dailyPaymentSnapshot: new Prisma.Decimal(400), workerNameSnapshot: 'T' },
    });
  });
}

const maybe = TEST_DB ? describe : describe.skip;

maybe('§12.4 direct-assignment capacity guard', () => {
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('1+2. an AWAITING_WORKER direct assignment reserves the position; a second is rejected', async () => {
    const job = await seedJob(1);
    // First direct regular assign is allowed against an empty job.
    await expect(guard(job, 'REGULAR')).resolves.toBeUndefined();
    // Create the AWAITING_WORKER reservation, then a second regular is rejected.
    await addShift(job.id, 'AWAITING_WORKER', 'REGULAR');
    await expect(guard(job, 'REGULAR')).rejects.toMatchObject({ code: 'JOB_FULL' });
  });

  it('3. an APPROVED worker with slotId=null still fills capacity', async () => {
    const job = await seedJob(1);
    await addShift(job.id, 'APPROVED', 'REGULAR', null); // slotId explicitly null
    await expect(guard(job, 'REGULAR')).rejects.toMatchObject({ code: 'JOB_FULL' });
  });

  it('4. backups do not reserve or fill a normal required position', async () => {
    const job = await seedJob(1);
    // A backup is always allowed and does not consume the regular position…
    await addShift(job.id, 'AWAITING_WORKER', 'BACKUP');
    await expect(guard(job, 'BACKUP')).resolves.toBeUndefined();
    await expect(guard(job, 'REGULAR')).resolves.toBeUndefined();
    // …but once the regular position is reserved, another regular is rejected while
    // a backup is still allowed.
    await addShift(job.id, 'APPROVED', 'REGULAR', null);
    await expect(guard(job, 'REGULAR')).rejects.toMatchObject({ code: 'JOB_FULL' });
    await expect(guard(job, 'BACKUP')).resolves.toBeUndefined();
  });

  it('leader position is reserved separately and only one leader is allowed', async () => {
    const job = await seedJob(2, { requiresLeader: true }); // regularRequired = 1
    // A regular is allowed while the leader slot is empty…
    await expect(guard(job, 'REGULAR')).resolves.toBeUndefined();
    await addShift(job.id, 'AWAITING_WORKER', 'TEAM_LEADER');
    // …the leader is now reserved → a second leader is rejected.
    await expect(guard(job, 'TEAM_LEADER')).rejects.toMatchObject({ code: 'LEADER_TAKEN' });
    // A regular is still allowed (leader reservation does not consume the regular).
    await expect(guard(job, 'REGULAR')).resolves.toBeUndefined();
    // Fill the regular position → the next regular is rejected.
    await addShift(job.id, 'APPROVED', 'REGULAR', null);
    await expect(guard(job, 'REGULAR')).rejects.toMatchObject({ code: 'JOB_FULL' });
  });

  it('rejects a leader when total capacity is full with regulars + missing leader, without creating a shift', async () => {
    const job = await seedJob(2, { requiresLeader: true });
    await addShift(job.id, 'APPROVED', 'REGULAR', null);
    await addShift(job.id, 'APPROVED', 'REGULAR', null); // both positions reserved by regulars
    const before = await prisma.shift.count({ where: { jobId: job.id } });
    await expect(guard(job, 'TEAM_LEADER')).rejects.toMatchObject({ code: 'JOB_FULL' });
    expect(await prisma.shift.count({ where: { jobId: job.id } })).toBe(before); // no shift created
  });

  it('allows an eligible leader when one total position remains and the leader is missing', async () => {
    const job = await seedJob(2, { requiresLeader: true });
    await addShift(job.id, 'APPROVED', 'REGULAR', null); // one position free
    await expect(guard(job, 'TEAM_LEADER')).resolves.toBeUndefined();
  });

  it('role-changing an existing regular to TEAM_LEADER resolves a full job without exceeding capacity', async () => {
    const job = await seedJob(2, { requiresLeader: true });
    const reg1 = await addShift(job.id, 'APPROVED', 'REGULAR', null);
    await addShift(job.id, 'APPROVED', 'REGULAR', null); // full, no leader
    // Adding a leader is blocked…
    await expect(guard(job, 'TEAM_LEADER')).rejects.toMatchObject({ code: 'JOB_FULL' });
    // …but converting an existing regular's role (as POST /shifts/:id/role does) is
    // the supported resolution: no new shift, capacity unchanged.
    await prisma.shift.update({ where: { id: reg1.id }, data: { assignmentRole: 'TEAM_LEADER' } });
    expect(await prisma.shift.count({ where: { jobId: job.id } })).toBe(2);
    const leaders = await prisma.shift.count({ where: { jobId: job.id, assignmentRole: 'TEAM_LEADER', joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] } } });
    expect(leaders).toBe(1);
    // A further direct leader is now rejected as a duplicate leader.
    await expect(guard(job, 'TEAM_LEADER')).rejects.toMatchObject({ code: 'LEADER_TAKEN' });
  });

  it('rejects a TEAM_LEADER assignment on a job that does not require a leader (LEADER_NOT_REQUIRED)', async () => {
    const job = await seedJob(2); // no leader slot
    await expect(guard(job, 'TEAM_LEADER')).rejects.toMatchObject({ code: 'LEADER_NOT_REQUIRED' });
  });

  it('concurrent direct assignments cannot exceed total required capacity', async () => {
    const job = await seedJob(1); // one position
    const [w1, w2] = [await seedWorker(), await seedWorker()];
    const results = await Promise.allSettled([assignInTx(job, 'REGULAR', w1.id), assignInTx(job, 'REGULAR', w2.id)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'JOB_FULL' });
    expect(await prisma.shift.count({ where: { jobId: job.id } })).toBe(1);
  });
});
