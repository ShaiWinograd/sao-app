/**
 * §16.2 / §16.4 / §17.3 attendance sweep integration tests.
 *
 * Exercises the real domain services against Postgres with a CONTROLLABLE clock
 * (every operation takes an explicit `now` — no real waiting). Gated by
 * TEST_DATABASE_URL; skipped in CI. Covers boundaries, idempotency, catch-up after
 * downtime, and concurrency/races.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMissingClockInProposals,
  processPendingAreaExits,
  sendEndFormReminders,
  markEndFormsOverdue,
} from './domain/attendanceSweep.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;
const at = (iso: string) => new Date(iso);

async function seedWorker() {
  const id = uid('w');
  const user = await prisma.user.create({ data: { id: uid('u'), email: `${id}@t.test`, firstName: 'T', lastName: id, role: 'WORKER' } });
  return prisma.worker.create({
    data: {
      id, userId: user.id, firstName: 'T', lastName: id, phone: '05', email: `${id}.w@t.test`,
      hourlyWage: new Prisma.Decimal(50), dailyPaymentAmount: new Prisma.Decimal(400), paymentMethod: 'BANK_TRANSFER', skills: [],
    },
  });
}

async function seedJob(opts: { start: Date; end: Date; withForm?: boolean }) {
  const customer = await prisma.customer.create({ data: { firstName: 'C', lastName: uid('c'), phone: '03', email: `${uid('c')}@t.test` } });
  const address = await prisma.address.create({ data: { customerId: customer.id, fullAddress: 'X 1', label: 'OTHER' } });
  const kase = await prisma.customerCase.create({ data: { customerId: customer.id, name: 'Case' } });
  let formTemplateId: string | null = null;
  if (opts.withForm) {
    const t = await prisma.formTemplate.create({ data: { name: 'End', jobType: 'PACKING' } });
    formTemplateId = t.id;
  }
  return prisma.job.create({
    data: {
      caseId: kase.id, customerId: customer.id, addressId: address.id, jobType: 'PACKING',
      date: opts.start, plannedStart: opts.start, plannedEnd: opts.end, requiredWorkerCount: 1,
      formTemplateId,
    },
  });
}

async function seedShift(jobId: string, workerId: string, data: Partial<Prisma.ShiftUncheckedCreateInput> & { scheduledStart: Date; scheduledEnd: Date }) {
  return prisma.shift.create({
    data: {
      workerId, jobId, joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR', attendanceStatus: 'SCHEDULED',
      hourlyWageSnapshot: new Prisma.Decimal(50), dailyPaymentSnapshot: new Prisma.Decimal(400), workerNameSnapshot: 'T',
      ...data,
    },
  });
}

describe.skipIf(!TEST_DB)('attendance sweep (integration)', () => {
  beforeAll(async () => { await prisma.$connect(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => {
    await prisma.notification.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.customerReportVersion.deleteMany();
    await prisma.shiftSwap.deleteMany();
    await prisma.replacementVolunteer.deleteMany();
    await prisma.replacementRequest.deleteMany();
    await prisma.locationCheck.deleteMany();
    await prisma.attendanceCorrection.deleteMany();
    await prisma.shift.deleteMany();
    await prisma.jobSlot.deleteMany();
    await prisma.job.deleteMany();
    await prisma.formTemplate.deleteMany();
    await prisma.customerCase.deleteMany();
    await prisma.address.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.workerAvailability.deleteMany();
    await prisma.worker.deleteMany();
    await prisma.user.deleteMany();
  });

  // ── §16.2 missing clock-in ──────────────────────────────────────────────────

  it('creates no proposal one second before the +15m boundary, one at the boundary', async () => {
    const start = at('2026-08-01T08:00:00.000Z');
    const w = await seedWorker();
    const job = await seedJob({ start, end: at('2026-08-01T16:00:00.000Z') });
    const shift = await seedShift(job.id, w.id, { scheduledStart: start, scheduledEnd: at('2026-08-01T16:00:00.000Z') });

    const before = await createMissingClockInProposals(prisma, at('2026-08-01T08:14:59.000Z'));
    expect(before.processed).toBe(0);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).attendanceStatus).toBe('SCHEDULED');

    const atBoundary = await createMissingClockInProposals(prisma, at('2026-08-01T08:15:00.000Z'));
    expect(atBoundary.processed).toBe(1);
    const s = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(s.attendanceStatus).toBe('PROPOSED');
    expect(s.proposedClockIn?.toISOString()).toBe(start.toISOString());
    expect(s.requiresReview).toBe(true);
  });

  it('does not duplicate a proposal on repeated sweeps', async () => {
    const start = at('2026-08-01T08:00:00.000Z');
    const w = await seedWorker();
    const job = await seedJob({ start, end: at('2026-08-01T16:00:00.000Z') });
    await seedShift(job.id, w.id, { scheduledStart: start, scheduledEnd: at('2026-08-01T16:00:00.000Z') });

    const now = at('2026-08-01T08:20:00.000Z');
    const r1 = await createMissingClockInProposals(prisma, now);
    const r2 = await createMissingClockInProposals(prisma, now);
    expect(r1.processed).toBe(1);
    expect(r2.processed).toBe(0); // already PROPOSED
    expect(await prisma.notification.count({ where: { title: 'לא נרשמה כניסה למשמרת' } })).toBe(1);
  });

  it('never proposes for a backup who did not clock in', async () => {
    const start = at('2026-08-01T08:00:00.000Z');
    const w = await seedWorker();
    const job = await seedJob({ start, end: at('2026-08-01T16:00:00.000Z') });
    const shift = await seedShift(job.id, w.id, { scheduledStart: start, scheduledEnd: at('2026-08-01T16:00:00.000Z'), assignmentRole: 'BACKUP' });

    const r = await createMissingClockInProposals(prisma, at('2026-08-01T09:00:00.000Z'));
    expect(r.scanned).toBe(0);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).attendanceStatus).toBe('SCHEDULED');
  });

  it('two simultaneous sweeps create exactly one proposal', async () => {
    const start = at('2026-08-01T08:00:00.000Z');
    const w = await seedWorker();
    const job = await seedJob({ start, end: at('2026-08-01T16:00:00.000Z') });
    await seedShift(job.id, w.id, { scheduledStart: start, scheduledEnd: at('2026-08-01T16:00:00.000Z') });

    const now = at('2026-08-01T08:30:00.000Z');
    const [a, b] = await Promise.all([createMissingClockInProposals(prisma, now), createMissingClockInProposals(prisma, now)]);
    expect(a.processed + b.processed).toBe(1);
    expect(await prisma.notification.count({ where: { title: 'לא נרשמה כניסה למשמרת' } })).toBe(1);
  });

  it('catch-up after downtime: still proposes for a shift eligible 20m ago', async () => {
    const start = at('2026-08-01T08:00:00.000Z');
    const w = await seedWorker();
    const job = await seedJob({ start, end: at('2026-08-01T16:00:00.000Z') });
    await seedShift(job.id, w.id, { scheduledStart: start, scheduledEnd: at('2026-08-01T16:00:00.000Z') });
    const r = await createMissingClockInProposals(prisma, at('2026-08-01T08:35:00.000Z'));
    expect(r.processed).toBe(1);
  });

  // ── §16.4 leaving-area auto clock-out ───────────────────────────────────────

  it('exit then return before deadline: no auto clock-out', async () => {
    const w = await seedWorker();
    const job = await seedJob({ start: at('2026-08-01T08:00:00.000Z'), end: at('2026-08-01T16:00:00.000Z') });
    const exitAt = at('2026-08-01T10:00:00.000Z');
    const shift = await seedShift(job.id, w.id, {
      scheduledStart: at('2026-08-01T08:00:00.000Z'), scheduledEnd: at('2026-08-01T16:00:00.000Z'),
      attendanceStatus: 'CLOCKED_IN', actualStart: at('2026-08-01T08:00:00.000Z'), areaExitAt: exitAt, areaExitDeadline: at('2026-08-01T10:15:00.000Z'),
    });
    // Worker returns → clear the timer (simulate /area-return).
    await prisma.shift.update({ where: { id: shift.id }, data: { areaExitAt: null, areaExitDeadline: null } });
    const r = await processPendingAreaExits(prisma, at('2026-08-01T10:20:00.000Z'));
    expect(r.scanned).toBe(0);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).attendanceStatus).toBe('CLOCKED_IN');
  });

  it('exit deadline passes: auto clock-out uses the recorded exit time, not now', async () => {
    const w = await seedWorker();
    const job = await seedJob({ start: at('2026-08-01T08:00:00.000Z'), end: at('2026-08-01T16:00:00.000Z') });
    const exitAt = at('2026-08-01T10:00:00.000Z');
    const shift = await seedShift(job.id, w.id, {
      scheduledStart: at('2026-08-01T08:00:00.000Z'), scheduledEnd: at('2026-08-01T16:00:00.000Z'),
      attendanceStatus: 'CLOCKED_IN', actualStart: at('2026-08-01T08:00:00.000Z'), areaExitAt: exitAt, areaExitDeadline: at('2026-08-01T10:15:00.000Z'),
    });
    // Sweep runs much later (downtime) — clock-out time must be the exit time.
    const r = await processPendingAreaExits(prisma, at('2026-08-01T11:30:00.000Z'));
    expect(r.processed).toBe(1);
    const s = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(s.attendanceStatus).toBe('AUTO_CLOCKED_OUT');
    expect(s.actualEnd?.toISOString()).toBe(exitAt.toISOString());
    expect(s.requiresReview).toBe(true);
    expect(Number(s.approvedHours)).toBe(2); // 08:00 → 10:00
  });

  it('manual clock-out racing the sweep: no auto clock-out overwrite', async () => {
    const w = await seedWorker();
    const job = await seedJob({ start: at('2026-08-01T08:00:00.000Z'), end: at('2026-08-01T16:00:00.000Z') });
    const shift = await seedShift(job.id, w.id, {
      scheduledStart: at('2026-08-01T08:00:00.000Z'), scheduledEnd: at('2026-08-01T16:00:00.000Z'),
      attendanceStatus: 'CLOCKED_IN', actualStart: at('2026-08-01T08:00:00.000Z'), areaExitAt: at('2026-08-01T10:00:00.000Z'), areaExitDeadline: at('2026-08-01T10:15:00.000Z'),
    });
    // A manual clock-out landed first.
    await prisma.shift.update({ where: { id: shift.id }, data: { attendanceStatus: 'CLOCKED_OUT', actualEnd: at('2026-08-01T10:05:00.000Z'), clockOutMethod: 'NORMAL' } });
    const r = await processPendingAreaExits(prisma, at('2026-08-01T10:30:00.000Z'));
    expect(r.processed).toBe(0);
    const s = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(s.attendanceStatus).toBe('CLOCKED_OUT');
    expect(s.actualEnd?.toISOString()).toBe('2026-08-01T10:05:00.000Z');
  });

  // ── §17.3 reminders / overdue ───────────────────────────────────────────────

  it('reminder due only 3h after clock-out, then 3h after last', async () => {
    const w = await seedWorker();
    const clockOut = at('2026-08-01T12:00:00.000Z');
    const job = await seedJob({ start: at('2026-08-01T08:00:00.000Z'), end: at('2026-08-01T16:00:00.000Z'), withForm: true });
    const shift = await seedShift(job.id, w.id, {
      scheduledStart: at('2026-08-01T08:00:00.000Z'), scheduledEnd: at('2026-08-01T16:00:00.000Z'),
      attendanceStatus: 'CLOCKED_OUT', actualStart: at('2026-08-01T08:00:00.000Z'), actualEnd: clockOut,
      formStatus: 'NOT_SUBMITTED', formDeadline: at('2026-08-02T20:59:59.000Z'),
    });

    expect((await sendEndFormReminders(prisma, at('2026-08-01T14:59:00.000Z'))).processed).toBe(0);
    expect((await sendEndFormReminders(prisma, at('2026-08-01T15:00:00.000Z'))).processed).toBe(1);
    // Not due again until 18:00.
    expect((await sendEndFormReminders(prisma, at('2026-08-01T17:59:00.000Z'))).processed).toBe(0);
    expect((await sendEndFormReminders(prisma, at('2026-08-01T18:00:00.000Z'))).processed).toBe(1);
    expect(await prisma.notification.count({ where: { title: 'תזכורת: טופס סיום משמרת' } })).toBe(2);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).formLastReminderAt?.toISOString()).toBe('2026-08-01T18:00:00.000Z');
  });

  it('no duplicate reminder when two sweeps run at the same time', async () => {
    const w = await seedWorker();
    const job = await seedJob({ start: at('2026-08-01T08:00:00.000Z'), end: at('2026-08-01T16:00:00.000Z'), withForm: true });
    await seedShift(job.id, w.id, {
      scheduledStart: at('2026-08-01T08:00:00.000Z'), scheduledEnd: at('2026-08-01T16:00:00.000Z'),
      attendanceStatus: 'CLOCKED_OUT', actualStart: at('2026-08-01T08:00:00.000Z'), actualEnd: at('2026-08-01T12:00:00.000Z'),
      formStatus: 'NOT_SUBMITTED', formDeadline: at('2026-08-02T20:59:59.000Z'),
    });
    const now = at('2026-08-01T16:00:00.000Z');
    const [a, b] = await Promise.all([sendEndFormReminders(prisma, now), sendEndFormReminders(prisma, now)]);
    expect(a.processed + b.processed).toBe(1);
    expect(await prisma.notification.count({ where: { title: 'תזכורת: טופס סיום משמרת' } })).toBe(1);
  });

  it('catch-up: only one reminder even after many missed 3h intervals', async () => {
    const w = await seedWorker();
    const job = await seedJob({ start: at('2026-08-01T08:00:00.000Z'), end: at('2026-08-01T16:00:00.000Z'), withForm: true });
    await seedShift(job.id, w.id, {
      scheduledStart: at('2026-08-01T08:00:00.000Z'), scheduledEnd: at('2026-08-01T16:00:00.000Z'),
      attendanceStatus: 'CLOCKED_OUT', actualStart: at('2026-08-01T08:00:00.000Z'), actualEnd: at('2026-08-01T12:00:00.000Z'),
      formStatus: 'NOT_SUBMITTED', formDeadline: at('2026-08-03T20:59:59.000Z'), formLastReminderAt: at('2026-08-01T15:00:00.000Z'),
    });
    // 12h after last reminder — a single catch-up, not four.
    const r = await sendEndFormReminders(prisma, at('2026-08-02T03:00:00.000Z'));
    expect(r.processed).toBe(1);
    expect(await prisma.notification.count({ where: { title: 'תזכורת: טופס סיום משמרת' } })).toBe(1);
  });

  it('marks a form overdue once and it remains submittable', async () => {
    const w = await seedWorker();
    const job = await seedJob({ start: at('2026-08-01T08:00:00.000Z'), end: at('2026-08-01T16:00:00.000Z'), withForm: true });
    const shift = await seedShift(job.id, w.id, {
      scheduledStart: at('2026-08-01T08:00:00.000Z'), scheduledEnd: at('2026-08-01T16:00:00.000Z'),
      attendanceStatus: 'CLOCKED_OUT', actualStart: at('2026-08-01T08:00:00.000Z'), actualEnd: at('2026-08-01T12:00:00.000Z'),
      formStatus: 'NOT_SUBMITTED', formDeadline: at('2026-08-02T20:59:59.000Z'),
    });
    const now = at('2026-08-03T00:00:00.000Z');
    const r1 = await markEndFormsOverdue(prisma, now);
    const r2 = await markEndFormsOverdue(prisma, now);
    expect(r1.processed).toBe(1);
    expect(r2.processed).toBe(0); // transition once
    const s = await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } });
    expect(s.formOverdue).toBe(true);
    expect(s.formStatus).toBe('NOT_SUBMITTED'); // still submittable
    expect(await prisma.notification.count({ where: { title: 'טופס סיום משמרת באיחור' } })).toBe(1);
  });

  it('one record failure does not block unrelated eligible records', async () => {
    const start = at('2026-08-01T08:00:00.000Z');
    const end = at('2026-08-01T16:00:00.000Z');
    const w1 = await seedWorker();
    const w2 = await seedWorker();
    const job = await seedJob({ start, end });
    const bad = await seedShift(job.id, w1.id, { scheduledStart: start, scheduledEnd: end });
    const good = await seedShift(job.id, w2.id, { scheduledStart: start, scheduledEnd: end });

    // Inject a deterministic failure for exactly the "bad" shift's PROPOSED update
    // via a trigger, so its per-record transaction fails while the good one commits.
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION _test_fail_bad() RETURNS trigger AS $BODY$ BEGIN IF NEW.id = '${bad.id}' AND NEW."attendanceStatus" = 'PROPOSED' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END; $BODY$ LANGUAGE plpgsql;`,
    );
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS _test_fail_bad_trg ON shifts;`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER _test_fail_bad_trg BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION _test_fail_bad();`);
    try {
      const r = await createMissingClockInProposals(prisma, at('2026-08-01T08:30:00.000Z'));
      expect(r.failed).toBe(1);
      expect(r.processed).toBe(1);
      expect((await prisma.shift.findUniqueOrThrow({ where: { id: good.id } })).attendanceStatus).toBe('PROPOSED');
      expect((await prisma.shift.findUniqueOrThrow({ where: { id: bad.id } })).attendanceStatus).toBe('SCHEDULED'); // rolled back
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS _test_fail_bad_trg ON shifts;`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS _test_fail_bad();`);
    }
  });
});
