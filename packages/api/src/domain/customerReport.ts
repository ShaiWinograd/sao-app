// Customer report domain (spec §18): readiness, immutable finalized versions,
// corrections, and snapshot → PDF rendering. All state changes are transactional
// and serialized per case (advisory lock) so finalization + case close + job
// marking + version/audit rows commit atomically and cannot double-bill a job.
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit.js';
import { lockCase } from '../lib/commitment.js';
import { AppError } from '../lib/errors.js';
import {
  computeCustomerReport,
  isCaseReadyForReport,
  type CustomerReport,
  type CustomerReportPricing,
} from '@workforce/shared';

type DbClient = Prisma.TransactionClient | typeof prisma;

const JOB_TYPE_HE_LABEL: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

export type ReportEditorInput = {
  pricing: CustomerReportPricing;
  includedJobIds?: string[];
  jobNotes?: Record<string, string>;
};

export type ReportSnapshot = {
  versionNumber: number;
  generatedAt: string;
  customerName: string;
  caseName: string;
  includedJobIds: string[];
  report: CustomerReport;
};

type ShiftLite = { joinRequestStatus: string; approvedHours: Prisma.Decimal | null; requiresReview: boolean };
type JobLite = { id: string; date: Date; jobType: string; status: string; reportedAt: Date | null; shifts: ShiftLite[] };
type CaseLite = {
  id: string;
  name: string;
  status: string;
  customerId: string;
  customer: { firstName: string; lastName: string };
  jobs: JobLite[];
};

const caseInclude = {
  customer: { select: { firstName: true, lastName: true } },
  jobs: {
    orderBy: { date: 'asc' as const },
    select: {
      id: true,
      date: true,
      jobType: true,
      status: true,
      reportedAt: true,
      shifts: { select: { joinRequestStatus: true, approvedHours: true, requiresReview: true } },
    },
  },
};

function workedHoursOf(shifts: ShiftLite[]): number[] {
  return shifts
    .filter((s) => s.joinRequestStatus === 'APPROVED' && s.approvedHours != null)
    .map((s) => Number(s.approvedHours));
}

function jobHasUnresolvedAttendance(job: JobLite): boolean {
  return job.shifts.some((s) => s.requiresReview);
}

// ─── Readiness (spec §18.1) — derived, never stored ───────────────────────────

export function evaluateReadiness(kase: CaseLite, hasFinalizedReport: boolean): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const relevant = kase.jobs.filter((j) => j.status !== 'ARCHIVED');
  if (kase.status !== 'ACTIVE') reasons.push('הפרויקט אינו פעיל');
  if (hasFinalizedReport) reasons.push('כבר קיים דוח לקוחה סופי');
  if (relevant.length === 0) reasons.push('אין עבודות בפרויקט');
  if (relevant.some((j) => j.status !== 'COMPLETED')) reasons.push('לא כל העבודות הושלמו');
  if (relevant.some((j) => jobHasUnresolvedAttendance(j))) reasons.push('נוכחות ממתינה לאישור');

  const ready = isCaseReadyForReport({
    caseStatus: kase.status,
    hasFinalizedReport,
    jobs: kase.jobs.map((j) => ({ status: j.status, hasUnresolvedAttendance: jobHasUnresolvedAttendance(j) })),
  });
  return { ready, reasons: ready ? [] : reasons };
}

export async function getCaseReadiness(client: DbClient, caseId: string): Promise<{ ready: boolean; reasons: string[] }> {
  const kase = (await client.customerCase.findUnique({ where: { id: caseId }, include: caseInclude })) as CaseLite | null;
  if (!kase) return { ready: false, reasons: ['הפרויקט לא נמצא'] };
  const versionCount = await client.customerReportVersion.count({ where: { caseId } });
  return evaluateReadiness(kase, versionCount > 0);
}

/** Count ACTIVE cases that are ready for a customer report (Requires Attention). */
export async function countReadyCases(client: DbClient = prisma): Promise<number> {
  const cases = (await client.customerCase.findMany({ where: { status: 'ACTIVE' }, include: caseInclude })) as CaseLite[];
  // ACTIVE cases never have a finalized report (finalize closes the case).
  return cases.filter((kase) => evaluateReadiness(kase, false).ready).length;
}

export type ReportsOverview = {
  ready: Array<{ caseId: string; customerName: string; jobCount: number; latestJobDate: string | null }>;
  closed: Array<{ caseId: string; customerName: string; latestVersion: number; finalAmount: number | null; updatedAt: Date }>;
};

/** Ready ACTIVE cases + recently CLOSED cases with a finalized report (spec §18.2/§18.14). */
export async function listReportsOverview(client: DbClient = prisma): Promise<ReportsOverview> {
  const active = (await client.customerCase.findMany({ where: { status: 'ACTIVE' }, include: caseInclude })) as CaseLite[];
  const ready = active
    .filter((k) => evaluateReadiness(k, false).ready)
    .map((k) => {
      const dates = k.jobs.map((j) => j.date.getTime());
      return {
        caseId: k.id,
        customerName: `${k.customer.firstName} ${k.customer.lastName}`.trim(),
        jobCount: k.jobs.filter((j) => j.status === 'COMPLETED').length,
        latestJobDate: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null,
      };
    });

  const closedCases = await client.customerCase.findMany({
    where: { status: 'CLOSED' },
    include: {
      customer: { select: { firstName: true, lastName: true } },
      reportVersions: { orderBy: { versionNumber: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  const closed = closedCases
    .filter((k) => k.reportVersions.length > 0)
    .map((k) => ({
      caseId: k.id,
      customerName: `${k.customer.firstName} ${k.customer.lastName}`.trim(),
      latestVersion: k.reportVersions[0].versionNumber,
      finalAmount: ((k.reportVersions[0].snapshot as any)?.report?.finalAmount ?? null) as number | null,
      updatedAt: k.updatedAt,
    }));

  return { ready, closed };
}

// ─── Snapshot building + preview ──────────────────────────────────────────────

function buildSnapshot(kase: CaseLite, includedJobs: JobLite[], input: ReportEditorInput, versionNumber: number): ReportSnapshot {
  const report = computeCustomerReport(
    includedJobs.map((j) => ({
      jobId: j.id,
      date: j.date,
      jobType: j.jobType,
      workedHours: workedHoursOf(j.shifts),
      ownerNote: input.jobNotes?.[j.id] ?? null,
    })),
    input.pricing,
  );
  return {
    versionNumber,
    generatedAt: new Date().toISOString(),
    customerName: `${kase.customer.firstName} ${kase.customer.lastName}`.trim(),
    caseName: kase.name,
    includedJobIds: includedJobs.map((j) => j.id),
    report,
  };
}

// The set of jobs a report may include: for an ACTIVE case, its Completed jobs;
// for a CLOSED case (corrections), exactly the jobs already bound to its chain.
function reportableJobs(kase: CaseLite): JobLite[] {
  if (kase.status === 'CLOSED') return kase.jobs.filter((j) => j.reportedAt != null);
  return kase.jobs.filter((j) => j.status === 'COMPLETED');
}

function resolveIncludedJobs(kase: CaseLite, includedJobIds?: string[]): JobLite[] {
  const candidates = reportableJobs(kase);
  if (!includedJobIds) return candidates;
  const set = new Set(includedJobIds);
  return candidates.filter((j) => set.has(j.id));
}

/** Non-persisting preview for the editor (ACTIVE case) or a correction (CLOSED). */
export async function previewCustomerReport(client: DbClient, caseId: string, input: ReportEditorInput): Promise<ReportSnapshot & { excludedJobIds: string[]; reportableJobs: Array<{ jobId: string; date: string; jobType: string; workerCount: number; actualHours: number; included: boolean }>; caseStatus: string }> {
  const kase = (await client.customerCase.findUnique({ where: { id: caseId }, include: caseInclude })) as CaseLite | null;
  if (!kase) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found');
  const included = resolveIncludedJobs(kase, input.includedJobIds);
  const includedSet = new Set(included.map((j) => j.id));
  const nextVersion = (await client.customerReportVersion.count({ where: { caseId } })) + 1;
  const snapshot = buildSnapshot(kase, included, input, nextVersion);

  const allReportable = reportableJobs(kase);
  const reportableJobsView = allReportable.map((j) => {
    const hours = workedHoursOf(j.shifts);
    return {
      jobId: j.id,
      date: j.date.toISOString().slice(0, 10),
      jobType: j.jobType,
      workerCount: hours.length,
      actualHours: Math.round((hours.reduce((s, h) => s + h, 0) + Number.EPSILON) * 100) / 100,
      included: includedSet.has(j.id),
    };
  });
  const excludedJobIds = allReportable.filter((j) => !includedSet.has(j.id)).map((j) => j.id);

  return { ...snapshot, excludedJobIds, reportableJobs: reportableJobsView, caseStatus: kase.status };
}

// ─── Finalize (spec §18.9, §18.13) — atomic ───────────────────────────────────

export async function finalizeCustomerReport(caseId: string, input: ReportEditorInput, actor?: { id?: string } | null, db: typeof prisma = prisma) {
  return db.$transaction(async (tx) => {
    await lockCase(tx, caseId);

    const kase = (await tx.customerCase.findUnique({ where: { id: caseId }, include: caseInclude })) as CaseLite | null;
    if (!kase) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found');
    if (kase.status !== 'ACTIVE') throw new AppError(409, 'CASE_ALREADY_CLOSED', 'הפרויקט כבר נסגר בדוח לקוחה');

    const versionCount = await tx.customerReportVersion.count({ where: { caseId } });
    const readiness = evaluateReadiness(kase, versionCount > 0);
    if (!readiness.ready) throw new AppError(409, 'CASE_NOT_READY', 'הפרויקט אינו מוכן לדוח לקוחה', { reasons: readiness.reasons });

    const completed = kase.jobs.filter((j) => j.status === 'COMPLETED');
    const includedIds = input.includedJobIds ?? completed.map((j) => j.id);
    const includedSet = new Set(includedIds);
    for (const id of includedIds) {
      const j = completed.find((x) => x.id === id);
      if (!j) throw new AppError(400, 'INVALID_JOB', 'עבודה לא תקינה לדוח');
      if (j.reportedAt) throw new AppError(409, 'JOB_ALREADY_REPORTED', 'עבודה כבר נכללה בדוח סופי');
    }
    const includedJobs = completed.filter((j) => includedSet.has(j.id));
    if (includedJobs.length === 0) throw new AppError(409, 'NO_JOBS_INCLUDED', 'יש לכלול לפחות עבודה אחת');
    const excludedJobs = completed.filter((j) => !includedSet.has(j.id));

    const snapshot = buildSnapshot(kase, includedJobs, input, versionCount + 1);
    const version = await tx.customerReportVersion.create({
      data: {
        caseId,
        versionNumber: versionCount + 1,
        status: 'FINALIZED',
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        createdById: actor?.id ?? null,
      },
    });

    // Bind the included jobs to this (now closing) case's report chain.
    await tx.job.updateMany({ where: { id: { in: includedJobs.map((j) => j.id) } }, data: { reportedAt: new Date() } });

    // Excluded completed jobs stay eligible → move them to a new ACTIVE case so
    // they are never lost and can be reported separately (spec §18.6).
    if (excludedJobs.length > 0) {
      const newCase = await tx.customerCase.create({
        data: { customerId: kase.customerId, name: kase.name, status: 'ACTIVE' },
        select: { id: true },
      });
      await tx.job.updateMany({ where: { id: { in: excludedJobs.map((j) => j.id) } }, data: { caseId: newCase.id } });
      await logAudit(actor ?? null, 'UPDATE', 'CustomerCase', newCase.id, null, { movedExcludedJobIds: excludedJobs.map((j) => j.id), fromCaseId: caseId }, 'customer-report:excluded-jobs-moved', tx);
    }

    await tx.customerCase.update({ where: { id: caseId }, data: { status: 'CLOSED' } });
    await logAudit(actor ?? null, 'UPDATE', 'CustomerCase', caseId, { status: 'ACTIVE' }, { status: 'CLOSED', versionNumber: version.versionNumber }, 'customer-report:finalized', tx);

    return version;
  });
}

// ─── Corrected version (spec §18.10) ──────────────────────────────────────────

export async function createCorrectedVersion(caseId: string, input: ReportEditorInput, actor?: { id?: string } | null, db: typeof prisma = prisma) {
  return db.$transaction(async (tx) => {
    await lockCase(tx, caseId);

    const kase = (await tx.customerCase.findUnique({ where: { id: caseId }, include: caseInclude })) as CaseLite | null;
    if (!kase) throw new AppError(404, 'CASE_NOT_FOUND', 'Case not found');
    if (kase.status !== 'CLOSED') throw new AppError(409, 'CASE_NOT_CLOSED', 'ניתן לתקן רק דוח שכבר הופק');

    const latest = await tx.customerReportVersion.findFirst({ where: { caseId }, orderBy: { versionNumber: 'desc' } });
    if (!latest) throw new AppError(409, 'NO_FINALIZED_REPORT', 'אין דוח סופי לתיקון');

    // Corrections never change job membership (no double billing) — the same bound
    // jobs are re-priced. Pricing/additions/notes may change.
    const boundJobs = kase.jobs.filter((j) => j.reportedAt != null);
    const snapshot = buildSnapshot(kase, boundJobs, input, latest.versionNumber + 1);

    const version = await tx.customerReportVersion.create({
      data: {
        caseId,
        versionNumber: latest.versionNumber + 1,
        status: 'FINALIZED',
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        createdById: actor?.id ?? null,
        supersedesId: latest.id,
      },
    });
    await logAudit(actor ?? null, 'UPDATE', 'CustomerCase', caseId, { versionNumber: latest.versionNumber }, { versionNumber: version.versionNumber }, 'customer-report:corrected', tx);
    return version;
  });
}

// ─── PDF rendering from a stored snapshot (spec §18.8) ────────────────────────
// Customer-facing lines only: per job date · type · worker count · hours. No
// worker names, individual attendance, pay, or internal notes (spec §18.7).

export function snapshotToPdfLines(snapshot: ReportSnapshot): string[] {
  const money = (n: number) => `${Number(n).toLocaleString('he-IL')} ₪`;
  const r = snapshot.report;
  const lines: string[] = [];
  lines.push(`לקוח: ${snapshot.customerName}`);
  lines.push(`גרסה: ${snapshot.versionNumber}`);
  lines.push('');
  lines.push('עבודות:');
  for (const job of r.jobs) {
    lines.push(`  ${job.date} · ${JOB_TYPE_HE_LABEL[job.jobType] ?? job.jobType} · ${job.workerCount} עובדים · ${job.actualHours} שעות`);
  }
  lines.push('');
  lines.push(`סך שעות עבודה בפועל: ${r.totalActualHours}`);
  if (r.mode === 'HOURLY') {
    lines.push(`תעריף שעתי: ${money(r.hourlyRate ?? 0)}`);
    for (const add of r.additions) {
      lines.push(`תוספת - ${add.description || 'ללא תיאור'}: ${money(add.amount)}`);
    }
  }
  lines.push(`סכום סופי: ${money(r.finalAmount)}`);
  return lines;
}
