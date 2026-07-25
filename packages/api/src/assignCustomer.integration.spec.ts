/**
 * §10.1 assign-real-customer-to-GR-job integration tests.
 *
 * Exercise the REAL database behavior of assignRealCustomerToJob (customer swap,
 * address reuse/clone WITHOUT mutating the shared GR row, 60-day case grouping,
 * worker notifications, audit) against a throwaway Postgres via TEST_DATABASE_URL;
 * skipped otherwise (CI has no DB).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/workforce_test \
 *     npm --workspace @workforce/api run test
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assignRealCustomerToJob } from './domain/assignCustomer.js';
import { AppError } from './lib/errors.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

const DAY = 86_400_000;
const BASE = new Date('2999-03-01T00:00:00.000Z').getTime();
const at = (n: number) => new Date(BASE + n * DAY);

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

async function clean() {
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.jobSlot.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.customerCase.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.appSetting.deleteMany({ where: { key: 'CASE_REOPEN_DAYS' } });
}

async function seedOwner() {
  return prisma.user.create({ data: { id: uid('owner'), email: `${uid('o')}@t.test`, firstName: 'O', lastName: 'wner', role: 'OWNER' } });
}

async function seedCustomer(opts: { isSystem?: boolean } = {}) {
  return prisma.customer.create({
    data: { firstName: 'C', lastName: uid('c'), phone: '03', email: `${uid('c')}@t.test`, isSystem: opts.isSystem ?? false },
  });
}

async function seedWorker() {
  const id = uid('w');
  const user = await prisma.user.create({ data: { id: uid('u'), email: `${id}@t.test`, firstName: 'T', lastName: id, role: 'WORKER' } });
  return prisma.worker.create({
    data: {
      id, userId: user.id, firstName: 'T', lastName: id, phone: '0500000000', email: `${id}.w@t.test`,
      hourlyWage: new Prisma.Decimal(50), dailyPaymentAmount: new Prisma.Decimal(400), paymentMethod: 'BANK_TRANSFER', skills: [],
    },
  });
}

/** A General-Reservation job: system customer, own case + address, at date `at(n)`. */
async function seedGrJob(grCustomerId: string, n = 0, addressText = 'הרצל 10 תל אביב') {
  const kase = await prisma.customerCase.create({ data: { customerId: grCustomerId, name: 'שריון', status: 'ACTIVE' } });
  const address = await prisma.address.create({ data: { customerId: grCustomerId, fullAddress: addressText, label: 'OTHER' } });
  const job = await prisma.job.create({
    data: {
      caseId: kase.id, customerId: grCustomerId, addressId: address.id, jobType: 'PACKING',
      date: at(n), plannedStart: at(n), plannedEnd: at(n), requiredWorkerCount: 2, status: 'RESERVATION',
    },
  });
  return { kase, address, job };
}

async function addShift(jobId: string, status: 'APPROVED' | 'PENDING' | 'AWAITING_WORKER' | 'REJECTED', attendance: 'SCHEDULED' | 'CLOCKED_IN' = 'SCHEDULED') {
  const worker = await seedWorker();
  const shift = await prisma.shift.create({
    data: {
      jobId, workerId: worker.id, scheduledStart: at(0), scheduledEnd: at(0),
      joinRequestStatus: status, assignmentRole: 'REGULAR', attendanceStatus: attendance,
      hourlyWageSnapshot: new Prisma.Decimal(50), dailyPaymentSnapshot: new Prisma.Decimal(400), workerNameSnapshot: 'T',
    },
  });
  return { worker, shift };
}

const maybe = TEST_DB ? describe : describe.skip;

maybe('§10.1 assignRealCustomerToJob', () => {
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('moves the job to a NEW active case for the target when none is eligible', async () => {
    const owner = await seedOwner();
    const gr = await seedCustomer({ isSystem: true });
    const target = await seedCustomer();
    const { job, kase: grCase } = await seedGrJob(gr.id);

    const res = await assignRealCustomerToJob(prisma, { jobId: job.id, customerId: target.id, actor: { id: owner.id } });

    expect(res.job.customerId).toBe(target.id);
    const newCase = await prisma.customerCase.findUnique({ where: { id: res.caseId } });
    expect(newCase?.customerId).toBe(target.id);
    expect(newCase?.status).toBe('ACTIVE');
    expect(res.caseId).not.toBe(grCase.id);
    // The empty GR case is left intact.
    expect(await prisma.customerCase.findUnique({ where: { id: grCase.id } })).not.toBeNull();
  });

  it('joins an eligible existing target case within 60 days (shared grouping rule)', async () => {
    const owner = await seedOwner();
    const gr = await seedCustomer({ isSystem: true });
    const target = await seedCustomer();
    // Target already has an ACTIVE case with a job 30 days before the GR job.
    const targetCase = await prisma.customerCase.create({ data: { customerId: target.id, name: 'T', status: 'ACTIVE' } });
    const tAddr = await prisma.address.create({ data: { customerId: target.id, fullAddress: 'A', label: 'OTHER' } });
    await prisma.job.create({
      data: { caseId: targetCase.id, customerId: target.id, addressId: tAddr.id, jobType: 'PACKING', date: at(0), plannedStart: at(0), plannedEnd: at(0), requiredWorkerCount: 1, status: 'RESERVATION' },
    });
    const { job } = await seedGrJob(gr.id, 30);

    const res = await assignRealCustomerToJob(prisma, { jobId: job.id, customerId: target.id, actor: { id: owner.id } });
    expect(res.caseId).toBe(targetCase.id);
  });

  it('does NOT mutate the shared GR address row; clones under the target then reuses it', async () => {
    const owner = await seedOwner();
    const gr = await seedCustomer({ isSystem: true });
    const target = await seedCustomer();
    const a = await seedGrJob(gr.id, 0, 'הרצל 10 תל אביב');
    const b = await seedGrJob(gr.id, 1, 'הרצל 10 תל אביב'); // same address text, own GR row

    const resA = await assignRealCustomerToJob(prisma, { jobId: a.job.id, customerId: target.id, actor: { id: owner.id } });
    const resB = await assignRealCustomerToJob(prisma, { jobId: b.job.id, customerId: target.id, actor: { id: owner.id } });

    // Both GR address rows are untouched (still under the GR customer).
    expect((await prisma.address.findUnique({ where: { id: a.address.id } }))?.customerId).toBe(gr.id);
    expect((await prisma.address.findUnique({ where: { id: b.address.id } }))?.customerId).toBe(gr.id);
    // Each job now points to a target-owned address, and the equivalent row is reused.
    expect(resA.addressId).not.toBe(a.address.id);
    expect(resB.addressId).toBe(resA.addressId);
    const targetAddrs = await prisma.address.findMany({ where: { customerId: target.id, fullAddress: 'הרצל 10 תל אביב' } });
    expect(targetAddrs).toHaveLength(1);
  });

  it('notifies assigned and pending workers (not rejected) and audits old/new ids', async () => {
    const owner = await seedOwner();
    const gr = await seedCustomer({ isSystem: true });
    const target = await seedCustomer();
    const { job, kase: grCase } = await seedGrJob(gr.id);
    const approved = await addShift(job.id, 'APPROVED');
    const pending = await addShift(job.id, 'PENDING');
    const rejected = await addShift(job.id, 'REJECTED');

    const res = await assignRealCustomerToJob(prisma, { jobId: job.id, customerId: target.id, actor: { id: owner.id } });

    expect(new Set(res.notifiedUserIds)).toEqual(new Set([approved.worker.userId, pending.worker.userId]));
    const notes = await prisma.notification.findMany({ where: { data: { path: ['type'], equals: 'JOB_CUSTOMER_ASSIGNED' } } });
    expect(notes.map((n) => n.userId).sort()).toEqual([approved.worker.userId, pending.worker.userId].sort());
    expect(notes.some((n) => n.userId === rejected.worker.userId)).toBe(false);

    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Job', entityId: job.id, reason: 'assign-customer' } });
    expect(audit).not.toBeNull();
    expect((audit!.previousValue as any).customerId).toBe(gr.id);
    expect((audit!.previousValue as any).caseId).toBe(grCase.id);
    expect((audit!.newValue as any).customerId).toBe(target.id);
    expect((audit!.newValue as any).caseId).toBe(res.caseId);
  });

  it('rejects a non-GR source job and makes no changes', async () => {
    const owner = await seedOwner();
    const real = await seedCustomer();
    const target = await seedCustomer();
    // A real-customer job (source is NOT the system customer).
    const kase = await prisma.customerCase.create({ data: { customerId: real.id, name: 'R', status: 'ACTIVE' } });
    const addr = await prisma.address.create({ data: { customerId: real.id, fullAddress: 'A', label: 'OTHER' } });
    const job = await prisma.job.create({ data: { caseId: kase.id, customerId: real.id, addressId: addr.id, jobType: 'PACKING', date: at(0), plannedStart: at(0), plannedEnd: at(0), requiredWorkerCount: 1, status: 'RESERVATION' } });

    await expect(assignRealCustomerToJob(prisma, { jobId: job.id, customerId: target.id, actor: { id: owner.id } })).rejects.toMatchObject({
      code: 'NOT_GENERAL_RESERVATION',
    });
    const after = await prisma.job.findUnique({ where: { id: job.id } });
    expect(after?.customerId).toBe(real.id);
    expect(after?.caseId).toBe(kase.id);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rejects a system target customer and makes no changes', async () => {
    const owner = await seedOwner();
    const gr = await seedCustomer({ isSystem: true });
    const otherSystem = await seedCustomer({ isSystem: true });
    const { job } = await seedGrJob(gr.id);

    await expect(assignRealCustomerToJob(prisma, { jobId: job.id, customerId: otherSystem.id, actor: { id: owner.id } })).rejects.toBeInstanceOf(AppError);
    const after = await prisma.job.findUnique({ where: { id: job.id } });
    expect(after?.customerId).toBe(gr.id);
    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('rejects once attendance has started and makes no changes', async () => {
    const owner = await seedOwner();
    const gr = await seedCustomer({ isSystem: true });
    const target = await seedCustomer();
    const { job } = await seedGrJob(gr.id);
    await addShift(job.id, 'APPROVED', 'CLOCKED_IN');

    await expect(assignRealCustomerToJob(prisma, { jobId: job.id, customerId: target.id, actor: { id: owner.id } })).rejects.toMatchObject({
      code: 'ATTENDANCE_STARTED',
    });
    const after = await prisma.job.findUnique({ where: { id: job.id } });
    expect(after?.customerId).toBe(gr.id);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});
