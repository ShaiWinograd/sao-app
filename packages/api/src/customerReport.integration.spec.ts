/**
 * §18 customer-report readiness + versioning + grouping integration tests.
 *
 * Exercise the REAL database guarantees (advisory-lock serialized finalize,
 * job→chain binding, derived readiness, date-window grouping) against a throwaway
 * Postgres via TEST_DATABASE_URL; skipped otherwise (the pure rules in
 * @workforce/shared are unit-tested in CI).
 *
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/workforce_test \
 *     npm --workspace @workforce/api run test
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { decideCaseForNewJob, resolveOrCreateCaseForJob } from './domain/caseResolution.js';
import {
  getCaseReadiness,
  finalizeCustomerReport,
  createCorrectedVersion,
  type ReportEditorInput,
} from './domain/customerReport.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

const DAY = 86_400_000;
const BASE = new Date('2999-01-01T00:00:00.000Z').getTime();
const at = (n: number) => new Date(BASE + n * DAY);

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

const HOURLY: ReportEditorInput = { pricing: { mode: 'HOURLY', hourlyRate: 100, additions: [] } };

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
  await prisma.appSetting.deleteMany({ where: { key: 'CASE_REOPEN_DAYS' } });
}

async function seedCustomer() {
  return prisma.customer.create({ data: { firstName: 'C', lastName: uid('c'), phone: '03', email: `${uid('c')}@t.test` } });
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

async function seedCase(customerId: string, status: 'ACTIVE' | 'CLOSED' = 'ACTIVE') {
  return prisma.customerCase.create({ data: { customerId, name: 'Case', status } });
}

async function addJob(caseId: string, customerId: string, date: Date, opts: { status?: string; completedWithHours?: number; requiresReview?: boolean } = {}) {
  const address = await prisma.address.create({ data: { customerId, fullAddress: 'X', label: 'OTHER' } });
  const job = await prisma.job.create({
    data: {
      caseId, customerId, addressId: address.id, jobType: 'PACKING',
      date, plannedStart: date, plannedEnd: date, requiredWorkerCount: 1,
      status: (opts.status ?? 'RESERVATION') as any,
    },
  });
  if (opts.completedWithHours != null) {
    const worker = await seedWorker();
    await prisma.shift.create({
      data: {
        jobId: job.id, workerId: worker.id, scheduledStart: date, scheduledEnd: date,
        joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR', attendanceStatus: 'CLOCKED_OUT',
        approvedHours: new Prisma.Decimal(opts.completedWithHours), requiresReview: opts.requiresReview ?? false,
        hourlyWageSnapshot: new Prisma.Decimal(50), dailyPaymentSnapshot: new Prisma.Decimal(400), workerNameSnapshot: 'T',
      },
    });
  }
  return job;
}

/** A ready ACTIVE case: one completed job with resolved attendance. */
async function seedReadyCase(hours = 8) {
  const customer = await seedCustomer();
  const kase = await seedCase(customer.id);
  const job = await addJob(kase.id, customer.id, at(0), { status: 'COMPLETED', completedWithHours: hours });
  return { customer, kase, job };
}

const maybe = TEST_DB ? describe : describe.skip;

maybe('§18 grouping (decideCaseForNewJob) — window basis = Job.date', () => {
  beforeEach(clean);
  afterAll(async () => { await prisma.$disconnect(); });

  it('groups within 60 days, on exactly 60, and creates a new case at 61', async () => {
    const c = await seedCustomer();
    const kase = await seedCase(c.id);
    await addJob(kase.id, c.id, at(0));
    expect((await decideCaseForNewJob(prisma, c.id, at(30))).caseId).toBe(kase.id);
    expect((await decideCaseForNewJob(prisma, c.id, at(60))).caseId).toBe(kase.id);
    expect((await decideCaseForNewJob(prisma, c.id, at(61))).caseId).toBeNull();
  });

  it('supports rolling and out-of-order grouping via the job-date range', async () => {
    const c = await seedCustomer();
    const kase = await seedCase(c.id);
    await addJob(kase.id, c.id, at(0));
    await addJob(kase.id, c.id, at(50));
    expect((await decideCaseForNewJob(prisma, c.id, at(100))).caseId).toBe(kase.id); // within 60 of latest (50)
    // Out of order: a case with only a future job accepts an earlier in-range job.
    const c2 = await seedCustomer();
    const k2 = await seedCase(c2.id);
    await addJob(k2.id, c2.id, at(100));
    expect((await decideCaseForNewJob(prisma, c2.id, at(50))).caseId).toBe(k2.id);
  });

  it('recalculates the range from live job dates (edits/moves are reflected)', async () => {
    const c = await seedCustomer();
    const kase = await seedCase(c.id);
    const job = await addJob(kase.id, c.id, at(0));
    expect((await decideCaseForNewJob(prisma, c.id, at(30))).caseId).toBe(kase.id);
    await prisma.job.update({ where: { id: job.id }, data: { date: at(200) } });
    expect((await decideCaseForNewJob(prisma, c.id, at(30))).caseId).toBeNull(); // range moved away
  });

  it('picks the closest eligible case deterministically and flags the anomaly', async () => {
    const c = await seedCustomer();
    const a = await seedCase(c.id);
    await addJob(a.id, c.id, at(0));
    const b = await seedCase(c.id);
    await addJob(b.id, c.id, at(100));
    const d = await decideCaseForNewJob(prisma, c.id, at(55));
    expect(d.eligibleCaseIds.sort()).toEqual([a.id, b.id].sort());
    expect(d.caseId).toBe(b.id); // closer range
    expect(d.anomaly).toBe(true);
  });

  it('honors CASE_REOPEN_DAYS configuration', async () => {
    await prisma.appSetting.create({ data: { key: 'CASE_REOPEN_DAYS', value: '30' } });
    const c = await seedCustomer();
    const kase = await seedCase(c.id);
    await addJob(kase.id, c.id, at(0));
    expect((await decideCaseForNewJob(prisma, c.id, at(30))).caseId).toBe(kase.id);
    expect((await decideCaseForNewJob(prisma, c.id, at(31))).caseId).toBeNull();
  });

  it('resolveOrCreateCaseForJob creates then reuses the same case', async () => {
    const c = await seedCustomer();
    const id1 = await prisma.$transaction((tx) => resolveOrCreateCaseForJob(tx, { customerId: c.id, caseName: 'C', newJobDate: at(0) }));
    await addJob(id1, c.id, at(0));
    const id2 = await prisma.$transaction((tx) => resolveOrCreateCaseForJob(tx, { customerId: c.id, caseName: 'C', newJobDate: at(20) }));
    expect(id2).toBe(id1);
  });
});

maybe('§18 readiness (derived, forms never block)', () => {
  beforeEach(clean);
  afterAll(async () => { await prisma.$disconnect(); });

  it('is ready with a completed, attendance-resolved job and no forms', async () => {
    const { kase } = await seedReadyCase();
    expect((await getCaseReadiness(prisma, kase.id)).ready).toBe(true);
  });

  it('is not ready when a job is still in flight', async () => {
    const { kase, customer } = await seedReadyCase();
    await addJob(kase.id, customer.id, at(1), { status: 'APPROVED' });
    expect((await getCaseReadiness(prisma, kase.id)).ready).toBe(false);
  });

  it('is not ready when attendance is unresolved', async () => {
    const c = await seedCustomer();
    const kase = await seedCase(c.id);
    await addJob(kase.id, c.id, at(0), { status: 'COMPLETED', completedWithHours: 8, requiresReview: true });
    expect((await getCaseReadiness(prisma, kase.id)).ready).toBe(false);
  });
});

maybe('§18 finalize + versioning + integrity', () => {
  beforeEach(clean);
  afterAll(async () => { await prisma.$disconnect(); });

  it('finalizes: closes the case, marks jobs reported, immutable snapshot', async () => {
    const { kase, job } = await seedReadyCase(8);
    const version = await finalizeCustomerReport(kase.id, HOURLY, null, prisma);
    expect(version.versionNumber).toBe(1);
    expect((version.snapshot as any).report.finalAmount).toBe(800);
    const after = await prisma.customerCase.findUnique({ where: { id: kase.id } });
    expect(after?.status).toBe('CLOSED');
    const j = await prisma.job.findUnique({ where: { id: job.id } });
    expect(j?.reportedAt).not.toBeNull();
  });

  it('PDF/version snapshot is reproducible — independent of later job changes', async () => {
    const { kase, job } = await seedReadyCase(8);
    const version = await finalizeCustomerReport(kase.id, HOURLY, null, prisma);
    // Mutate live hours afterwards.
    await prisma.shift.updateMany({ where: { jobId: job.id }, data: { approvedHours: new Prisma.Decimal(99) } });
    const stored = await prisma.customerReportVersion.findUnique({ where: { id: version.id } });
    expect((stored!.snapshot as any).report.totalActualHours).toBe(8); // unchanged
  });

  it('excluded completed jobs stay eligible (moved atomically to a new same-customer ACTIVE case)', async () => {
    const c = await seedCustomer();
    const kase = await seedCase(c.id);
    const j1 = await addJob(kase.id, c.id, at(0), { status: 'COMPLETED', completedWithHours: 5 });
    const j2 = await addJob(kase.id, c.id, at(1), { status: 'COMPLETED', completedWithHours: 6 });
    await finalizeCustomerReport(kase.id, { ...HOURLY, includedJobIds: [j1.id] }, null, prisma);

    const job2 = await prisma.job.findUnique({ where: { id: j2.id } });
    expect(job2?.caseId).not.toBe(kase.id);
    expect(job2?.reportedAt).toBeNull();
    const newCase = await prisma.customerCase.findUnique({ where: { id: job2!.caseId } });
    expect(newCase?.status).toBe('ACTIVE');
    expect(newCase?.customerId).toBe(c.id); // same customer

    // Grouping range for the new case is derived from its moved job (day 1).
    expect((await decideCaseForNewJob(prisma, c.id, at(2))).caseId).toBe(newCase!.id);
    // And the new case can itself become ready for its own report.
    expect((await getCaseReadiness(prisma, newCase!.id)).ready).toBe(true);
  });

  it('cannot include a job already bound to another finalized chain', async () => {
    const { kase, customer, job } = await seedReadyCase(8);
    const j2 = await addJob(kase.id, customer.id, at(1), { status: 'COMPLETED', completedWithHours: 4 });
    await prisma.job.update({ where: { id: j2.id }, data: { reportedAt: new Date() } });
    // Case is still ready via the unreported job; explicitly including the already
    // reported job is rejected.
    await expect(finalizeCustomerReport(kase.id, { ...HOURLY, includedJobIds: [job.id, j2.id] }, null, prisma)).rejects.toMatchObject({ code: 'JOB_ALREADY_REPORTED' });
  });

  it('a new job after finalization creates a NEW case (closed case never reused)', async () => {
    const { kase, customer } = await seedReadyCase(8);
    await finalizeCustomerReport(kase.id, HOURLY, null, prisma);
    const newId = await prisma.$transaction((tx) => resolveOrCreateCaseForJob(tx, { customerId: customer.id, caseName: 'C', newJobDate: at(5) }));
    expect(newId).not.toBe(kase.id);
    const created = await prisma.customerCase.findUnique({ where: { id: newId } });
    expect(created?.status).toBe('ACTIVE');
  });

  it('concurrent finalize: exactly one succeeds, the other is rejected', async () => {
    const { kase } = await seedReadyCase(8);
    const results = await Promise.allSettled([
      finalizeCustomerReport(kase.id, HOURLY, null, prisma),
      finalizeCustomerReport(kase.id, HOURLY, null, prisma),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('finalize persists a durable PDF artifact (spec §18.8)', async () => {
    const { kase } = await seedReadyCase(8);
    const version = await finalizeCustomerReport(kase.id, HOURLY, null, prisma);
    const stored = await prisma.customerReportVersion.findUnique({ where: { id: version.id } });
    expect(stored?.pdf).toBeTruthy();
    const bytes = Buffer.from(stored!.pdf as Buffer);
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF'); // real PDF header
  });

  it('corrected version: same chain, preserves history, does not re-mark jobs or touch v1', async () => {
    const { kase, job } = await seedReadyCase(8);
    const v1 = await finalizeCustomerReport(kase.id, HOURLY, null, prisma);
    const v1SnapshotBefore = JSON.stringify((await prisma.customerReportVersion.findUnique({ where: { id: v1.id } }))!.snapshot);
    const reportedAtBefore = (await prisma.job.findUnique({ where: { id: job.id } }))!.reportedAt;

    const v2 = await createCorrectedVersion(kase.id, { pricing: { mode: 'HOURLY', hourlyRate: 200, additions: [] } }, null, prisma);
    expect(v2.versionNumber).toBe(2);
    expect(v2.supersedesId).toBe(v1.id); // same chain
    expect((v2.snapshot as any).report.finalAmount).toBe(1600); // 8h × 200, same single job
    expect((v2.snapshot as any).includedJobIds).toEqual([job.id]); // same jobs, not re-added

    // v1 snapshot is immutable; jobs are not re-marked; case stays CLOSED.
    const v1After = await prisma.customerReportVersion.findUnique({ where: { id: v1.id } });
    expect(JSON.stringify(v1After!.snapshot)).toBe(v1SnapshotBefore);
    expect((await prisma.job.findUnique({ where: { id: job.id } }))!.reportedAt).toEqual(reportedAtBefore);
    expect((await prisma.customerCase.findUnique({ where: { id: kase.id } }))?.status).toBe('CLOSED');

    const all = await prisma.customerReportVersion.findMany({ where: { caseId: kase.id } });
    expect(all).toHaveLength(2); // both preserved
  });

  it('rejects finalize on a not-ready case and correction on an active case', async () => {
    const c = await seedCustomer();
    const kase = await seedCase(c.id);
    await addJob(kase.id, c.id, at(0), { status: 'COMPLETED', completedWithHours: 8 });
    await addJob(kase.id, c.id, at(1), { status: 'APPROVED' }); // in flight
    await expect(finalizeCustomerReport(kase.id, HOURLY, null, prisma)).rejects.toMatchObject({ code: 'CASE_NOT_READY' });
    await expect(createCorrectedVersion(kase.id, HOURLY, null, prisma)).rejects.toMatchObject({ code: 'CASE_NOT_CLOSED' });
    // Atomic: the rejected finalize left NO partial state.
    expect(await prisma.customerReportVersion.count({ where: { caseId: kase.id } })).toBe(0);
    expect((await prisma.customerCase.findUnique({ where: { id: kase.id } }))?.status).toBe('ACTIVE');
    expect(await prisma.job.count({ where: { caseId: kase.id, reportedAt: { not: null } } })).toBe(0);
  });
});
