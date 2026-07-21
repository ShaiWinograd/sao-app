// Customer-case resolution for new jobs (spec §18.12, §10.1).
//
// THE single shared resolver that decides which CustomerCase a new job joins.
// Every job-creation flow must use this — never a duplicated SQL/date condition.
// The rule (see @workforce/shared case-grouping): among the customer's ACTIVE
// (non-closed) cases, a new job joins one whose job-date range is within
// CASE_REOPEN_DAYS of the new job's date; otherwise a new ACTIVE case is created.
// A case closed by a finalized report is never a candidate (status != ACTIVE).
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit.js';
import {
  selectCaseForJob,
  caseRangeFromJobDates,
  resolveCaseReopenDays,
  type GroupingCandidate,
} from '@workforce/shared';

type DbClient = Prisma.TransactionClient | typeof prisma;

export type CaseDecision = {
  caseId: string | null;
  eligibleCaseIds: string[];
  anomaly: boolean;
  windowDays: number;
};

/** Read the configured grouping window (positive int; default 60). */
export async function getCaseReopenDays(client: DbClient = prisma): Promise<number> {
  const setting = await client.appSetting.findUnique({ where: { key: 'CASE_REOPEN_DAYS' } });
  return resolveCaseReopenDays(setting?.value);
}

/**
 * Decide which existing ACTIVE case (if any) a new job joins — pure DB read + the
 * shared rule. Returns `caseId: null` when a new case must be created.
 */
export async function decideCaseForNewJob(
  client: DbClient,
  customerId: string,
  newJobDate: Date,
): Promise<CaseDecision> {
  const windowDays = await getCaseReopenDays(client);

  const cases = await client.customerCase.findMany({
    where: { customerId, status: 'ACTIVE' },
    select: { id: true, jobs: { select: { date: true } } },
  });

  const candidates: GroupingCandidate[] = [];
  for (const c of cases) {
    const range = caseRangeFromJobDates(c.jobs.map((j) => j.date));
    if (range) candidates.push({ caseId: c.id, ...range });
  }

  const decision = selectCaseForJob(newJobDate, candidates, windowDays);
  return {
    caseId: decision.chosenCaseId,
    eligibleCaseIds: decision.eligibleCaseIds,
    anomaly: decision.anomaly,
    windowDays,
  };
}

/**
 * Decide + create if necessary, returning the case id the new job should use.
 * Must run inside the caller's write transaction so the (possible) new case and
 * the job commit atomically. Logs an audit anomaly when more than one ACTIVE case
 * was eligible (never silently merges cases — spec §18.12.7).
 */
export async function resolveOrCreateCaseForJob(
  tx: Prisma.TransactionClient,
  params: { customerId: string; caseName: string; newJobDate: Date; actor?: { id?: string } | null },
): Promise<string> {
  const decision = await decideCaseForNewJob(tx, params.customerId, params.newJobDate);

  if (decision.anomaly) {
    await logAudit(
      params.actor ?? null,
      'UPDATE',
      'CustomerCase',
      decision.caseId ?? 'multiple',
      null,
      { eligibleCaseIds: decision.eligibleCaseIds, chosen: decision.caseId, customerId: params.customerId },
      'case-grouping:multiple-eligible-cases',
      tx,
    );
  }

  if (decision.caseId) return decision.caseId;

  const created = await tx.customerCase.create({
    data: { customerId: params.customerId, name: params.caseName || 'שריון', status: 'ACTIVE' },
    select: { id: true },
  });
  return created.id;
}
