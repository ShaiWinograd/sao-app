#!/usr/bin/env node
/**
 * Scoped, reviewed cleanup for a SINGLE test customer's full graph.
 *
 * ⚠️  DRAFT — do NOT run without an approved dry-run + deletion-plan review.
 * ⚠️  Never commit production IDs. IDs are passed at runtime only.
 *
 * Safety guarantees:
 *   • Requires an explicit --customer <id>.
 *   • Dry-run by DEFAULT; deletion requires BOTH --execute AND --confirm <same id>.
 *   • Verifies TEST markers (firstName === "TEST" or internalNotes contains a
 *     smoke-test marker); refuses system customers.
 *   • Enumerates the FULL graph and prints per-table row counts (the plan).
 *   • PROTECTS seed users, workers, and salary history (WorkerMonthlyReport):
 *     it never deletes users/workers/monthly reports, and ABORTS if any monthly
 *     report references a shift in scope.
 *   • Preserves audit history (does not delete AuditLog rows) and writes ONE
 *     durable cleanup audit record summarising the deletion.
 *   • Deletes transactionally (all-or-nothing).
 *   • ABORTS if the graph changed between the dry-run snapshot and execution.
 *
 * Usage:
 *   Dry-run (default) — writes a snapshot the execute step must match:
 *     DATABASE_URL=... node scripts/cleanup-test-customer.mjs --customer <id> --snapshot /tmp/plan.json
 *   Execute (after review):
 *     DATABASE_URL=... node scripts/cleanup-test-customer.mjs --customer <id> --confirm <id> --execute --snapshot /tmp/plan.json
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(name);

const customerId = arg('--customer');
const execute = has('--execute');
const confirm = arg('--confirm');
const snapshotPath = arg('--snapshot');

function die(msg, code = 2) {
  console.error(`ABORT: ${msg}`);
  process.exit(code);
}

if (!customerId) die('--customer <id> is required');
if (!snapshotPath) die('--snapshot <path> is required (dry-run writes it; execute verifies it)');
if (execute && confirm !== customerId) die('--execute requires --confirm <same customer id>');

const prisma = new PrismaClient();

const SMOKE_MARKER = /(SMOKE\s*TEST|PROD SMOKE|TEST)/i;

function verifyMarkers(customer) {
  if (!customer) die(`customer ${customerId} not found`);
  if (customer.isSystem) die('refusing to touch a SYSTEM customer');
  const marked =
    (customer.firstName ?? '').trim().toUpperCase() === 'TEST' ||
    SMOKE_MARKER.test(customer.internalNotes ?? '') ||
    SMOKE_MARKER.test(`${customer.firstName ?? ''} ${customer.lastName ?? ''}`);
  if (!marked) {
    die('customer is not marked as TEST (firstName "TEST" or internalNotes smoke-test marker). Refusing to delete.');
  }
}

/** Enumerate the exact graph to be deleted (scoped strictly to this customer). */
async function enumerate(db) {
  const customer = await db.customer.findUnique({ where: { id: customerId } });
  if (!customer) return null;

  const cases = await db.customerCase.findMany({ where: { customerId }, select: { id: true } });
  const caseIds = cases.map((c) => c.id).sort();
  const jobs = await db.job.findMany({ where: { customerId }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id).sort();
  const shifts = await db.shift.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } });
  const shiftIds = shifts.map((s) => s.id).sort();
  const addresses = await db.address.findMany({ where: { customerId }, select: { id: true } });
  const addressIds = addresses.map((a) => a.id).sort();

  const counts = {
    customerReportVersions: await db.customerReportVersion.count({ where: { caseId: { in: caseIds } } }),
    formAnswers: await db.formAnswer.count({ where: { submission: { shiftId: { in: shiftIds } } } }),
    formSubmissions: await db.formSubmission.count({ where: { shiftId: { in: shiftIds } } }),
    attendanceCorrections: await db.attendanceCorrection.count({ where: { shiftId: { in: shiftIds } } }),
    locationChecks: await db.locationCheck.count({ where: { shiftId: { in: shiftIds } } }),
    replacementRequests: await db.replacementRequest.count({ where: { shiftId: { in: shiftIds } } }),
    shiftSwaps: await db.shiftSwap.count({ where: { OR: [{ fromShiftId: { in: shiftIds } }, { toShiftId: { in: shiftIds } }] } }),
    jobSlots: await db.jobSlot.count({ where: { jobId: { in: jobIds } } }),
    jobExpenses: await db.jobExpense.count({ where: { jobId: { in: jobIds } } }),
    shifts: shiftIds.length,
    jobs: jobIds.length,
    addresses: addressIds.length,
    customerCases: caseIds.length,
    customer: 1,
  };

  // Salary-history protection: monthly reports must never be deleted; abort if any
  // references a shift in scope.
  const salaryRefs = await db.workerMonthlyReport.count({ where: { shiftId: { in: shiftIds } } });

  return { customer, caseIds, jobIds, shiftIds, addressIds, counts, salaryRefs };
}

function graphHash(graph) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ customerId, caseIds: graph.caseIds, jobIds: graph.jobIds, shiftIds: graph.shiftIds, addressIds: graph.addressIds }))
    .digest('hex');
}

async function main() {
  const graph = await enumerate(prisma);
  verifyMarkers(graph?.customer);

  if (graph.salaryRefs > 0) {
    die(`${graph.salaryRefs} WorkerMonthlyReport row(s) reference in-scope shifts — refusing to delete salary history. Investigate manually.`);
  }

  const hash = graphHash(graph);
  console.log('── Cleanup plan (scoped to customer ' + customerId + ') ──');
  console.log('customer:', graph.customer.firstName, graph.customer.lastName, '| isSystem:', graph.customer.isSystem);
  console.table(graph.counts);
  console.log('graph hash:', hash);

  if (!execute) {
    writeFileSync(snapshotPath, JSON.stringify({ customerId, hash, counts: graph.counts, capturedAt: new Date().toISOString() }, null, 2));
    console.log(`\nDRY-RUN only. Snapshot written to ${snapshotPath}.`);
    console.log('Review the plan, then re-run with --execute --confirm ' + customerId + ' --snapshot ' + snapshotPath);
    return;
  }

  // Execute: the graph must be identical to the reviewed snapshot.
  if (!existsSync(snapshotPath)) die('snapshot file not found — run the dry-run first');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  if (snapshot.customerId !== customerId) die('snapshot is for a different customer');
  if (snapshot.hash !== hash) die('graph changed since the dry-run snapshot — re-run the dry-run and re-review');

  // A real owner/admin actor is required for the durable audit record.
  const actor = await prisma.user.findFirst({ where: { role: { in: ['OWNER', 'ADMIN'] }, isActive: true }, select: { id: true } });
  if (!actor) die('no active owner/admin user found to attribute the cleanup audit record');

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction (defence in depth).
    const live = await enumerate(tx);
    verifyMarkers(live?.customer);
    if (live.salaryRefs > 0) die('salary references appeared mid-transaction');
    if (graphHash(live) !== hash) throw new Error('ABORT: graph changed at execution time');

    const { caseIds, jobIds, shiftIds } = live;

    // Children first (ShiftSwap + ReplacementVolunteer cascade on delete).
    await tx.customerReportVersion.deleteMany({ where: { caseId: { in: caseIds } } });
    await tx.formAnswer.deleteMany({ where: { submission: { shiftId: { in: shiftIds } } } });
    await tx.formSubmission.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await tx.attendanceCorrection.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await tx.locationCheck.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await tx.replacementRequest.deleteMany({ where: { shiftId: { in: shiftIds } } });
    await tx.jobSlot.deleteMany({ where: { jobId: { in: jobIds } } });
    await tx.jobExpense.deleteMany({ where: { jobId: { in: jobIds } } });
    await tx.shift.deleteMany({ where: { jobId: { in: jobIds } } });
    await tx.job.deleteMany({ where: { customerId } });
    await tx.address.deleteMany({ where: { customerId } });
    await tx.customerCase.deleteMany({ where: { customerId } });

    // One durable cleanup audit record BEFORE deleting the customer (audit history
    // is otherwise left intact).
    await tx.auditLog.create({
      data: {
        performedById: actor.id,
        action: 'DELETE',
        entityType: 'Customer',
        entityId: customerId,
        previousValue: { name: `${live.customer.firstName} ${live.customer.lastName}`.trim() },
        newValue: { deleted: true, counts: live.counts, hash },
        reason: 'test-data-cleanup:scoped',
      },
    });

    await tx.customer.delete({ where: { id: customerId } });
  });

  console.log('\n✅ Deleted the test customer graph transactionally. Audit record written.');
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
