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
});
