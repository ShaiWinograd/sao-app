// Aggregated owner "Requires Attention" tasks for the dashboard (spec §7).
//
// Existing decision items are simple counts. The two priority-1 operational items
// (§7.3 items 1–2, §7.4) additionally return job-level rows so the owner can open
// each affected job directly:
//   - todayInReservation: jobs scheduled for TODAY still in RESERVATION;
//   - pastNotCompleted:   overdue jobs still RESERVATION/APPROVED.
// Both are derived from job status + date (no stored/snooze state) and use the
// business timezone for the "today" boundary — see @workforce/shared attention-jobs.
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { countReadyCases } from './customerReport.js';
import {
  classifyAttentionJobs,
  businessTomorrowStartUtc,
  type AttentionJob,
  type AttentionJobInput,
  type AttentionJobStatus,
} from '@workforce/shared';

type DbClient = Prisma.TransactionClient | typeof prisma;

export type AttentionJobView = {
  jobId: string;
  date: string;
  plannedStart: string;
  status: AttentionJobStatus;
  customerName: string;
  jobType: string | null;
};

export type OwnerTasks = {
  joinRequests: number;
  pendingAcceptance: number;
  replacementRequests: number;
  swapApprovals: number;
  attendanceReview: number;
  reportCorrections: number;
  customerReportReady: number;
  // Priority-1 operational items (§7.4): counts + directly-linkable job rows.
  todayInReservation: number;
  pastNotCompleted: number;
  todayInReservationJobs: AttentionJobView[];
  pastNotCompletedJobs: AttentionJobView[];
};

function toView(job: AttentionJob): AttentionJobView {
  return {
    jobId: job.jobId,
    date: job.date,
    plannedStart: job.plannedStart,
    status: job.status,
    customerName: job.customerName,
    jobType: job.jobType ?? null,
  };
}

/**
 * Compute all owner attention tasks. `now` is injectable for deterministic tests;
 * defaults to the current instant. Only today + past active jobs are read (bounded
 * by the business-timezone tomorrow boundary); COMPLETED/ARCHIVED are excluded at
 * the query and again defensively in the shared classifier.
 */
export async function computeOwnerTasks(client: DbClient = prisma, now: Date = new Date()): Promise<OwnerTasks> {
  const tomorrowStart = businessTomorrowStartUtc(now);

  const [
    joinRequests,
    pendingAcceptance,
    replacementRequests,
    swapApprovals,
    attendanceReview,
    reportCorrections,
    customerReportReady,
    candidateJobs,
  ] = await Promise.all([
    client.shift.count({ where: { joinRequestStatus: 'PENDING' } }),
    client.shift.count({ where: { joinRequestStatus: 'AWAITING_WORKER' } }),
    client.replacementRequest.count({ where: { status: 'PENDING' } }),
    client.shiftSwap.count({ where: { status: 'PENDING_OWNER' } }),
    // §16: attendance needing owner review — missing-clock-in proposals,
    // out-of-range / no-permission clock-ins, and automatic clock-outs. Missing
    // end forms are intentionally NOT here (they are informational — §17.3).
    client.shift.count({ where: { requiresReview: true } }),
    client.workerMonthlyReport.count({ where: { status: 'CORRECTION_REQUESTED' } }),
    // §18.1: cases ready for a customer report (owner action possible).
    countReadyCases(client),
    // §7.3(1–2): today + past open jobs, bounded by the business-tz day boundary.
    client.job.findMany({
      where: { status: { in: ['RESERVATION', 'APPROVED'] }, date: { lt: tomorrowStart } },
      select: {
        id: true,
        date: true,
        status: true,
        plannedStart: true,
        jobType: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const inputs: AttentionJobInput[] = candidateJobs.map((j) => ({
    jobId: j.id,
    date: j.date.toISOString(),
    status: j.status as AttentionJobStatus,
    plannedStart: j.plannedStart.toISOString(),
    customerName: `${j.customer?.firstName ?? ''} ${j.customer?.lastName ?? ''}`.trim(),
    jobType: j.jobType,
  }));

  const groups = classifyAttentionJobs(inputs, now);

  return {
    joinRequests,
    pendingAcceptance,
    replacementRequests,
    swapApprovals,
    attendanceReview,
    reportCorrections,
    customerReportReady,
    todayInReservation: groups.todayInReservation.length,
    pastNotCompleted: groups.pastNotCompleted.length,
    todayInReservationJobs: groups.todayInReservation.map(toView),
    pastNotCompletedJobs: groups.pastNotCompleted.map(toView),
  };
}
