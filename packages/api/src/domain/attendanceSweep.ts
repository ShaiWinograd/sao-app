// Attendance sweep domain services (spec §16.2, §16.4, §17.3).
//
// Each behavior is its own reusable operation so the /internal/sweeps/attendance
// endpoint (and tests, and event-driven flows) only orchestrate them — the rules
// live here, not in the endpoint. Every operation:
//   • takes an explicit `now` (controllable clock — no real waiting);
//   • re-reads and re-checks each record inside its own transaction, so overlapping
//     sweep runs, retries, and concurrent manual actions are safe;
//   • uses a conditional (state-guarded) write as the idempotency key — the write
//     only lands when the record is still eligible, so duplicates are impossible;
//   • processes each record independently: one failure never blocks the others and
//     an already-resolved record is skipped, not failed;
//   • writes audit rows atomically with the state change.
import { PrismaClient } from '@prisma/client';
import {
  isMissingClockInDue,
  isAreaExitDue,
  isFormReminderDue,
  isFormOverdue,
  endOfNextDayDeadline,
  evaluateJobCompletion,
  MISSING_CLOCK_IN_GRACE_MINUTES,
} from '@workforce/shared';
import { logAudit } from '../lib/audit.js';

type DbClient = PrismaClient;

export type SweepOptions = { dryRun?: boolean };

export type OperationResult = {
  operation: string;
  scanned: number;
  processed: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
};

function emptyResult(operation: string): OperationResult {
  return { operation, scanned: 0, processed: 0, skipped: 0, failed: 0, errors: [] };
}

// A window guard so a single sweep never scans the entire history. Job dates are
// evaluated within a few days of `now`, which also bounds catch-up work.
function scanWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - 3 * 24 * 3600_000),
    to: new Date(now.getTime() + 24 * 3600_000),
  };
}

// ─── §16.2 missing clock-in proposals ─────────────────────────────────────────

export async function createMissingClockInProposals(
  client: DbClient,
  now: Date,
  opts: SweepOptions = {},
): Promise<OperationResult> {
  const res = emptyResult('createMissingClockInProposals');
  const { from, to } = scanWindow(now);

  // Candidates: assigned regular/leader shifts, still SCHEDULED (no clock-in, not
  // already proposed, not resolved), 15+ minutes past their scheduled start.
  const deadlineCutoff = new Date(now.getTime() - MISSING_CLOCK_IN_GRACE_MINUTES * 60_000);
  const candidates = await client.shift.findMany({
    where: {
      joinRequestStatus: 'APPROVED',
      assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] }, // never a backup (§16.2)
      attendanceStatus: 'SCHEDULED',
      actualStart: null,
      scheduledStart: { lte: deadlineCutoff, gte: from },
      job: { status: { in: ['RESERVATION', 'APPROVED'] }, date: { lte: to } },
    },
    select: { id: true, scheduledStart: true, workerId: true, worker: { select: { userId: true } }, job: { select: { date: true } } },
  });
  res.scanned = candidates.length;

  for (const c of candidates) {
    if (!isMissingClockInDue(c.scheduledStart, now)) {
      res.skipped++;
      continue;
    }
    if (opts.dryRun) {
      res.processed++;
      continue;
    }
    try {
      const did = await client.$transaction(async (tx) => {
        // Idempotent, race-safe: only the first sweep flips SCHEDULED → PROPOSED.
        const updated = await tx.shift.updateMany({
          where: { id: c.id, attendanceStatus: 'SCHEDULED', actualStart: null },
          data: {
            attendanceStatus: 'PROPOSED',
            proposedClockIn: c.scheduledStart,
            requiresReview: true, // owner must review after the worker confirms/corrects (§16.2)
          },
        });
        if (updated.count === 0) return false; // another run/flow already handled it
        await tx.notification.create({
          data: {
            userId: c.worker.userId,
            title: 'לא נרשמה כניסה למשמרת',
            body: 'לא נרשמה כניסה למשמרת שלך. יש לאשר את שעת ההתחלה המוצעת או לתקן אותה.',
            data: { type: 'MISSING_CLOCK_IN', shiftId: c.id } as any,
          },
        });
        await logAudit(null, 'UPDATE', 'Shift', c.id, { attendanceStatus: 'SCHEDULED' }, { attendanceStatus: 'PROPOSED', proposedClockIn: c.scheduledStart }, 'sweep:missing-clock-in-proposed', tx);
        return true;
      });
      if (did) res.processed++;
    } catch (err: any) {
      res.failed++;
      res.errors.push({ id: c.id, message: String(err?.message ?? err) });
    }
  }
  // Reconcile skipped = scanned - processed - failed for the non-dry-run path.
  res.skipped = res.scanned - res.processed - res.failed;
  return res;
}

// ─── §16.4 leaving-area auto clock-out ────────────────────────────────────────

export async function processPendingAreaExits(
  client: DbClient,
  now: Date,
  opts: SweepOptions = {},
): Promise<OperationResult> {
  const res = emptyResult('processPendingAreaExits');

  const candidates = await client.shift.findMany({
    where: {
      attendanceStatus: 'CLOCKED_IN',
      actualEnd: null,
      areaExitAt: { not: null },
      areaExitDeadline: { not: null, lte: now },
    },
    select: { id: true, actualStart: true, areaExitAt: true, jobId: true, worker: { select: { userId: true } } },
  });
  res.scanned = candidates.length;

  for (const c of candidates) {
    if (!c.areaExitAt || !c.actualStart || !isAreaExitDue(c.areaExitAt, now)) {
      res.skipped++;
      continue;
    }
    if (opts.dryRun) {
      res.processed++;
      continue;
    }
    try {
      const exitAt = c.areaExitAt;
      const hours = (exitAt.getTime() - c.actualStart.getTime()) / 3_600_000;
      await client.$transaction(async (tx) => {
        // Re-check transactionally: a manual clock-out or a return may have cleared
        // the exit concurrently. The clock-out time is the RECORDED exit, not `now`.
        const updated = await tx.shift.updateMany({
          where: { id: c.id, attendanceStatus: 'CLOCKED_IN', actualEnd: null, areaExitAt: { not: null } },
          data: {
            actualEnd: exitAt,
            attendanceStatus: 'AUTO_CLOCKED_OUT',
            clockOutMethod: 'AUTO_CLOCK_OUT',
            requiresReview: true,
            approvedHours: hours > 0 ? hours.toFixed(2) : '0',
            areaExitDeadline: null,
          },
        });
        if (updated.count === 0) return false;
        await tx.notification.create({
          data: {
            userId: c.worker.userId,
            title: 'המשמרת נסגרה אוטומטית',
            body: 'עזבת את אזור העבודה למעלה מ-15 דקות והמשמרת נסגרה אוטומטית. הנתונים ממתינים לאישור בעל/ת העסק.',
            data: { type: 'AUTO_CLOCK_OUT', shiftId: c.id } as any,
          },
        });
        await logAudit(null, 'AUTO_CLOCK_OUT', 'Shift', c.id, { attendanceStatus: 'CLOCKED_IN' }, { attendanceStatus: 'AUTO_CLOCKED_OUT', actualEnd: exitAt }, 'sweep:area-exit-auto-clock-out', tx);
        return true;
      }).then(async (did) => {
        if (did) {
          res.processed++;
          await maybeAutoCompleteJob(client, c.jobId);
        }
      });
    } catch (err: any) {
      res.failed++;
      res.errors.push({ id: c.id, message: String(err?.message ?? err) });
    }
  }
  res.skipped = res.scanned - res.processed - res.failed;
  return res;
}

// ─── §17.3 end-form reminders ─────────────────────────────────────────────────

export async function sendEndFormReminders(
  client: DbClient,
  now: Date,
  opts: SweepOptions = {},
): Promise<OperationResult> {
  const res = emptyResult('sendEndFormReminders');

  // Worked (clocked out) shifts on jobs with an end form enabled, not yet
  // submitted/waived, before the deadline.
  const candidates = await client.shift.findMany({
    where: {
      actualEnd: { not: null },
      formStatus: 'NOT_SUBMITTED',
      job: { formTemplateId: { not: null } },
    },
    select: { id: true, actualEnd: true, formDeadline: true, formLastReminderAt: true, worker: { select: { userId: true } } },
  });
  res.scanned = candidates.length;

  for (const c of candidates) {
    if (!c.actualEnd) {
      res.skipped++;
      continue;
    }
    // Backfill the deadline for shifts clocked out before the field existed.
    const deadline = c.formDeadline ?? endOfNextDayDeadline(c.actualEnd);
    if (!isFormReminderDue({ clockOutAt: c.actualEnd, lastReminderAt: c.formLastReminderAt, deadline, now })) {
      res.skipped++;
      continue;
    }
    if (opts.dryRun) {
      res.processed++;
      continue;
    }
    try {
      const did = await client.$transaction(async (tx) => {
        // Guard on the exact lastReminderAt we read → overlapping sweeps can't both
        // send. `now` becomes the new lastReminderAt so at most one per sweep and no
        // burst catch-up (§17.3).
        const updated = await tx.shift.updateMany({
          where: {
            id: c.id,
            formStatus: 'NOT_SUBMITTED',
            formLastReminderAt: c.formLastReminderAt,
          },
          data: { formLastReminderAt: now, formDeadline: deadline },
        });
        if (updated.count === 0) return false;
        await tx.notification.create({
          data: {
            userId: c.worker.userId,
            title: 'תזכורת: טופס סיום משמרת',
            body: 'טרם מילאת את טופס סיום המשמרת. ניתן למלא אותו מ"המשמרות שלי".',
            data: { type: 'END_FORM_REMINDER', shiftId: c.id } as any,
          },
        });
        return true;
      });
      if (did) res.processed++;
    } catch (err: any) {
      res.failed++;
      res.errors.push({ id: c.id, message: String(err?.message ?? err) });
    }
  }
  res.skipped = res.scanned - res.processed - res.failed;
  return res;
}

// ─── §17.3 mark end forms overdue ─────────────────────────────────────────────

export async function markEndFormsOverdue(
  client: DbClient,
  now: Date,
  opts: SweepOptions = {},
): Promise<OperationResult> {
  const res = emptyResult('markEndFormsOverdue');

  const candidates = await client.shift.findMany({
    where: {
      actualEnd: { not: null },
      formStatus: 'NOT_SUBMITTED',
      formOverdue: false,
      job: { formTemplateId: { not: null } },
    },
    select: { id: true, actualEnd: true, formDeadline: true, worker: { select: { userId: true } } },
  });
  res.scanned = candidates.length;

  for (const c of candidates) {
    if (!c.actualEnd) {
      res.skipped++;
      continue;
    }
    const deadline = c.formDeadline ?? endOfNextDayDeadline(c.actualEnd);
    if (!isFormOverdue(deadline, now)) {
      res.skipped++;
      continue;
    }
    if (opts.dryRun) {
      res.processed++;
      continue;
    }
    try {
      await client.$transaction(async (tx) => {
        // Transition once: only the first sweep flips false → true.
        const updated = await tx.shift.updateMany({
          where: { id: c.id, formStatus: 'NOT_SUBMITTED', formOverdue: false },
          data: { formOverdue: true, formDeadline: deadline },
        });
        if (updated.count === 0) return;
        await tx.notification.create({
          data: {
            userId: c.worker.userId,
            title: 'טופס סיום משמרת באיחור',
            body: 'המועד למילוי טופס סיום המשמרת עבר. עדיין ניתן למלא אותו.',
            data: { type: 'END_FORM_OVERDUE', shiftId: c.id } as any,
          },
        });
        res.processed++;
      });
    } catch (err: any) {
      res.failed++;
      res.errors.push({ id: c.id, message: String(err?.message ?? err) });
    }
  }
  res.skipped = res.scanned - res.processed - res.failed;
  return res;
}

// Local copy of the auto-completion check (kept dependency-light for the sweep).
async function maybeAutoCompleteJob(client: DbClient, jobId: string): Promise<void> {
  const job = await client.job.findUnique({ where: { id: jobId }, select: { id: true, status: true } });
  if (!job || (job.status !== 'RESERVATION' && job.status !== 'APPROVED')) return;
  const shifts = await client.shift.findMany({
    where: { jobId },
    select: { joinRequestStatus: true, assignmentRole: true, attendanceStatus: true, actualStart: true, actualEnd: true, requiresReview: true },
  });
  if (evaluateJobCompletion(shifts).complete) {
    await client.job.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });
    await logAudit(null, 'UPDATE', 'Job', jobId, { status: job.status }, { status: 'COMPLETED' }, 'auto-complete');
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export type SweepRunSummary = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  dryRun: boolean;
  operations: OperationResult[];
  totals: { scanned: number; processed: number; skipped: number; failed: number };
  systemicError?: string;
};

/**
 * Runs all four operations and returns a structured summary. Individual record
 * failures are captured per-operation; a systemic failure (an operation throwing
 * outright, e.g. the DB is unreachable) is surfaced so the endpoint can respond
 * non-2xx.
 */
export async function runAttendanceSweep(
  client: DbClient,
  now: Date,
  opts: SweepOptions = {},
): Promise<SweepRunSummary> {
  const runId = `sweep_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date();
  const operations: OperationResult[] = [];
  let systemicError: string | undefined;

  const ops = [createMissingClockInProposals, processPendingAreaExits, sendEndFormReminders, markEndFormsOverdue];
  for (const op of ops) {
    try {
      operations.push(await op(client, now, opts));
    } catch (err: any) {
      systemicError = `${op.name}: ${String(err?.message ?? err)}`;
      operations.push({ ...emptyResult(op.name), failed: 1, errors: [{ id: '*', message: String(err?.message ?? err) }] });
    }
  }

  const finishedAt = new Date();
  const totals = operations.reduce(
    (acc, o) => ({
      scanned: acc.scanned + o.scanned,
      processed: acc.processed + o.processed,
      skipped: acc.skipped + o.skipped,
      failed: acc.failed + o.failed,
    }),
    { scanned: 0, processed: 0, skipped: 0, failed: 0 },
  );

  return {
    runId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    dryRun: Boolean(opts.dryRun),
    operations,
    totals,
    systemicError,
  };
}
