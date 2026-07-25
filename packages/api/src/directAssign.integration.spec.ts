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
import { changeShiftRole } from './domain/roleChange.js';
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

async function seedOwner() {
  return prisma.user.create({ data: { id: uid('owner'), email: `${uid('o')}@t.test`, firstName: 'O', lastName: 'wner', role: 'OWNER' } });
}

async function seedWorker(opts: { leaderEligible?: boolean } = {}) {
  const id = uid('w');
  const user = await prisma.user.create({ data: { id: uid('u'), email: `${id}@t.test`, firstName: 'T', lastName: id, role: 'WORKER' } });
  return prisma.worker.create({
    data: { id, userId: user.id, firstName: 'T', lastName: id, phone: '0500000000', email: `${id}.w@t.test`, hourlyWage: new Prisma.Decimal(50), dailyPaymentAmount: new Prisma.Decimal(400), paymentMethod: 'BANK_TRANSFER', skills: opts.leaderEligible ? ['SHIFT_LEADER'] : [] },
  });
}

async function addShift(jobId: string, status: string, role: string, slotId: string | null = null, opts: { leaderEligible?: boolean } = {}) {
  const worker = await seedWorker(opts);
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

// A client whose in-transaction audit write always fails — used to prove the role
// update and audit row commit atomically (the update must roll back with the audit).
function clientWithFailingAudit(base: PrismaClient) {
  return {
    $transaction: (cb: (tx: any) => Promise<any>) =>
      base.$transaction((tx: any) => {
        const wrapped = new Proxy(tx, {
          get(t, prop) {
            if (prop === 'auditLog') {
              return { create: async () => { throw new Error('audit-boom'); } };
            }
            const v = (t as any)[prop];
            return typeof v === 'function' ? v.bind(t) : v;
          },
        });
        return cb(wrapped);
      }),
  } as unknown as PrismaClient;
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

  it('role-changing an existing regular to TEAM_LEADER (via changeShiftRole) resolves a full job without exceeding capacity', async () => {
    const owner = await seedOwner();
    const job = await seedJob(2, { requiresLeader: true });
    const reg1 = await addShift(job.id, 'APPROVED', 'REGULAR', null, { leaderEligible: true });
    await addShift(job.id, 'APPROVED', 'REGULAR', null); // full, no leader
    const before = await prisma.shift.count({ where: { jobId: job.id } });
    // Adding a new leader is blocked…
    await expect(guard(job, 'TEAM_LEADER')).rejects.toMatchObject({ code: 'JOB_FULL' });
    // …but converting the existing regular through the REAL role-change flow is the
    // supported resolution: no new shift, capacity unchanged, leader now present.
    await changeShiftRole(prisma, owner, { shiftId: reg1.id, role: 'TEAM_LEADER' });
    expect(await prisma.shift.count({ where: { jobId: job.id } })).toBe(before);
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

maybe('§10–§11 role-change (changeShiftRole)', () => {
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  const reservingNonBackup = (jobId: string) =>
    prisma.shift.count({ where: { jobId, joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] }, assignmentRole: { not: 'BACKUP' } } });
  const leaderCount = (jobId: string) =>
    prisma.shift.count({ where: { jobId, assignmentRole: 'TEAM_LEADER', joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] } } });
  const roleOf = async (shiftId: string) => (await prisma.shift.findUnique({ where: { id: shiftId } }))?.assignmentRole;
  const auditCount = (shiftId: string) => prisma.auditLog.count({ where: { entityType: 'Shift', entityId: shiftId, reason: 'role-change' } });

  it('1. eligible REGULAR → TEAM_LEADER on a full job succeeds without increasing the non-backup count', async () => {
    const owner = await seedOwner();
    const job = await seedJob(2, { requiresLeader: true });
    const reg = await addShift(job.id, 'APPROVED', 'REGULAR', null, { leaderEligible: true });
    await addShift(job.id, 'APPROVED', 'REGULAR', null); // full, no leader
    const before = await reservingNonBackup(job.id);
    await changeShiftRole(prisma, owner, { shiftId: reg.id, role: 'TEAM_LEADER' });
    expect(await reservingNonBackup(job.id)).toBe(before); // capacity unchanged
    expect(await leaderCount(job.id)).toBe(1);
    expect(await roleOf(reg.id)).toBe('TEAM_LEADER');
    expect(await auditCount(reg.id)).toBe(1); // update + audit both committed
  });

  it('2. ineligible REGULAR → TEAM_LEADER is rejected with no mutation and no audit', async () => {
    const owner = await seedOwner();
    const job = await seedJob(2, { requiresLeader: true });
    const reg = await addShift(job.id, 'APPROVED', 'REGULAR', null); // not leader-eligible
    await expect(changeShiftRole(prisma, owner, { shiftId: reg.id, role: 'TEAM_LEADER' })).rejects.toMatchObject({ code: 'NOT_LEADER_ELIGIBLE' });
    expect(await roleOf(reg.id)).toBe('REGULAR');
    expect(await auditCount(reg.id)).toBe(0);
    expect(await leaderCount(job.id)).toBe(0);
  });

  it('3. concurrent conversions cannot create two leaders', async () => {
    const owner = await seedOwner();
    const job = await seedJob(3, { requiresLeader: true }); // room for both as regulars
    const a = await addShift(job.id, 'APPROVED', 'REGULAR', null, { leaderEligible: true });
    const b = await addShift(job.id, 'APPROVED', 'REGULAR', null, { leaderEligible: true });
    const results = await Promise.allSettled([
      changeShiftRole(prisma, owner, { shiftId: a.id, role: 'TEAM_LEADER' }),
      changeShiftRole(prisma, owner, { shiftId: b.id, role: 'TEAM_LEADER' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'LEADER_TAKEN' });
    expect(await leaderCount(job.id)).toBe(1);
  });

  it('4. TEAM_LEADER on a job that does not require a leader is rejected', async () => {
    const owner = await seedOwner();
    const job = await seedJob(2); // no leader slot
    const reg = await addShift(job.id, 'APPROVED', 'REGULAR', null, { leaderEligible: true });
    await expect(changeShiftRole(prisma, owner, { shiftId: reg.id, role: 'TEAM_LEADER' })).rejects.toMatchObject({ code: 'LEADER_NOT_REQUIRED' });
    expect(await roleOf(reg.id)).toBe('REGULAR');
  });

  it('5. BACKUP → REGULAR is rejected when full and allowed when capacity is available', async () => {
    const owner = await seedOwner();
    // Full: the single required position is already reserved by a regular.
    const full = await seedJob(1);
    await addShift(full.id, 'APPROVED', 'REGULAR', null);
    const backupFull = await addShift(full.id, 'APPROVED', 'BACKUP', null);
    await expect(changeShiftRole(prisma, owner, { shiftId: backupFull.id, role: 'REGULAR' })).rejects.toMatchObject({ code: 'JOB_FULL' });
    expect(await roleOf(backupFull.id)).toBe('BACKUP');
    // Available: one of two positions is free.
    const free = await seedJob(2);
    await addShift(free.id, 'APPROVED', 'REGULAR', null);
    const backupFree = await addShift(free.id, 'APPROVED', 'BACKUP', null);
    await changeShiftRole(prisma, owner, { shiftId: backupFree.id, role: 'REGULAR' });
    expect(await roleOf(backupFree.id)).toBe('REGULAR');
  });

  it('6. BACKUP → TEAM_LEADER respects both eligibility and total capacity', async () => {
    const owner = await seedOwner();
    // Ineligible backup (capacity available) → NOT_LEADER_ELIGIBLE.
    const j1 = await seedJob(2, { requiresLeader: true });
    const ineligible = await addShift(j1.id, 'APPROVED', 'BACKUP', null);
    await expect(changeShiftRole(prisma, owner, { shiftId: ineligible.id, role: 'TEAM_LEADER' })).rejects.toMatchObject({ code: 'NOT_LEADER_ELIGIBLE' });
    // Eligible backup but the job is full → JOB_FULL (a leader consumes a position).
    const j2 = await seedJob(1, { requiresLeader: true });
    await addShift(j2.id, 'APPROVED', 'REGULAR', null);
    const eligibleFull = await addShift(j2.id, 'APPROVED', 'BACKUP', null, { leaderEligible: true });
    await expect(changeShiftRole(prisma, owner, { shiftId: eligibleFull.id, role: 'TEAM_LEADER' })).rejects.toMatchObject({ code: 'JOB_FULL' });
    expect(await roleOf(eligibleFull.id)).toBe('BACKUP');
    // Eligible backup with capacity → succeeds.
    const j3 = await seedJob(2, { requiresLeader: true });
    await addShift(j3.id, 'APPROVED', 'REGULAR', null);
    const eligibleOk = await addShift(j3.id, 'APPROVED', 'BACKUP', null, { leaderEligible: true });
    await changeShiftRole(prisma, owner, { shiftId: eligibleOk.id, role: 'TEAM_LEADER' });
    expect(await roleOf(eligibleOk.id)).toBe('TEAM_LEADER');
    expect(await leaderCount(j3.id)).toBe(1);
  });

  it('7. the role update and audit entry are atomic (audit failure rolls back the role change)', async () => {
    const owner = await seedOwner();
    const job = await seedJob(2, { requiresLeader: true });
    const reg = await addShift(job.id, 'APPROVED', 'REGULAR', null, { leaderEligible: true });
    await addShift(job.id, 'APPROVED', 'REGULAR', null);
    await expect(changeShiftRole(clientWithFailingAudit(prisma), owner, { shiftId: reg.id, role: 'TEAM_LEADER' })).rejects.toThrow('audit-boom');
    // Neither the role nor an audit row survived — they commit together.
    expect(await roleOf(reg.id)).toBe('REGULAR');
    expect(await auditCount(reg.id)).toBe(0);
    expect(await leaderCount(job.id)).toBe(0);
  });
});

