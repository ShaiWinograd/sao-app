import { describe, expect, it } from 'vitest';
import { businessTomorrowStartUtc } from '@workforce/shared';
import { computeOwnerTasks } from './ownerTasks.js';

// Unit test with a mocked Prisma client (no DB, runs in CI). Verifies that the
// existing decision counts pass through unchanged and that the two priority-1
// job lists are derived + ordered correctly, and that only today + past open
// jobs are queried (bounded by the business-timezone tomorrow boundary).

// Jerusalem noon (summer, UTC+3) → 09:00 UTC. "Today" = 2026-07-25.
const NOW = new Date('2026-07-25T09:00:00.000Z');

function d(iso: string): Date {
  return new Date(iso);
}

const CANDIDATE_JOBS = [
  // Today, RESERVATION — ordered by start time (noon then afternoon).
  { id: 'today-noon', date: d('2026-07-25T00:00:00.000Z'), status: 'RESERVATION', plannedStart: d('2026-07-25T12:00:00.000Z'), jobType: 'PACKING', customer: { firstName: 'נועה', lastName: 'לוי' } },
  { id: 'today-morning', date: d('2026-07-25T00:00:00.000Z'), status: 'RESERVATION', plannedStart: d('2026-07-25T07:00:00.000Z'), jobType: 'PACKING', customer: { firstName: 'דנה', lastName: 'כהן' } },
  // Today, APPROVED — excluded from today-in-reservation.
  { id: 'today-approved', date: d('2026-07-25T00:00:00.000Z'), status: 'APPROVED', plannedStart: d('2026-07-25T08:00:00.000Z'), jobType: 'PACKING', customer: { firstName: 'x', lastName: 'y' } },
  // Past — oldest first (23rd before 24th).
  { id: 'past-24', date: d('2026-07-24T00:00:00.000Z'), status: 'APPROVED', plannedStart: d('2026-07-24T09:00:00.000Z'), jobType: 'UNPACKING', customer: { firstName: 'רון', lastName: 'מזרחי' } },
  { id: 'past-23', date: d('2026-07-23T00:00:00.000Z'), status: 'RESERVATION', plannedStart: d('2026-07-23T09:00:00.000Z'), jobType: 'PACKING', customer: { firstName: 'שירה', lastName: 'פרץ' } },
  // Defensive: a COMPLETED row must never surface even if returned by the query.
  { id: 'past-completed', date: d('2026-07-24T00:00:00.000Z'), status: 'COMPLETED', plannedStart: d('2026-07-24T09:00:00.000Z'), jobType: 'PACKING', customer: { firstName: 'a', lastName: 'b' } },
];

function makeClient(capture: { where?: any }) {
  return {
    shift: {
      count: async ({ where }: any) => {
        if (where.joinRequestStatus === 'PENDING') return 3;
        if (where.joinRequestStatus === 'AWAITING_WORKER') return 2;
        if (where.requiresReview === true) return 4;
        return 0;
      },
    },
    replacementRequest: { count: async () => 5 },
    shiftSwap: { count: async () => 1 },
    workerMonthlyReport: { count: async () => 6 },
    // countReadyCases → 0 ready cases.
    customerCase: { findMany: async () => [] },
    job: {
      findMany: async ({ where }: any) => {
        capture.where = where;
        return CANDIDATE_JOBS;
      },
    },
  } as any;
}

describe('computeOwnerTasks', () => {
  it('retains existing decision counts unchanged', async () => {
    const tasks = await computeOwnerTasks(makeClient({}), NOW);
    expect(tasks.joinRequests).toBe(3);
    expect(tasks.pendingAcceptance).toBe(2);
    expect(tasks.replacementRequests).toBe(5);
    expect(tasks.swapApprovals).toBe(1);
    expect(tasks.attendanceReview).toBe(4);
    expect(tasks.reportCorrections).toBe(6);
    expect(tasks.customerReportReady).toBe(0);
  });

  it('derives the two priority-1 job lists with counts', async () => {
    const tasks = await computeOwnerTasks(makeClient({}), NOW);
    expect(tasks.todayInReservation).toBe(2);
    expect(tasks.pastNotCompleted).toBe(2);
    expect(tasks.todayInReservationJobs.map((j) => j.jobId)).toEqual(['today-morning', 'today-noon']);
    expect(tasks.pastNotCompletedJobs.map((j) => j.jobId)).toEqual(['past-23', 'past-24']);
  });

  it('excludes APPROVED-today and COMPLETED jobs from the lists', async () => {
    const tasks = await computeOwnerTasks(makeClient({}), NOW);
    const ids = [...tasks.todayInReservationJobs, ...tasks.pastNotCompletedJobs].map((j) => j.jobId);
    expect(ids).not.toContain('today-approved');
    expect(ids).not.toContain('past-completed');
  });

  it('includes directly-linkable job fields (jobId, date, status, customer name)', async () => {
    const tasks = await computeOwnerTasks(makeClient({}), NOW);
    const row = tasks.todayInReservationJobs[0];
    expect(row).toMatchObject({
      jobId: 'today-morning',
      status: 'RESERVATION',
      customerName: 'דנה כהן',
      jobType: 'PACKING',
    });
    expect(row.date).toBe('2026-07-25T00:00:00.000Z');
  });

  it('queries only today + past open jobs, bounded by the business tomorrow boundary', async () => {
    const capture: { where?: any } = {};
    await computeOwnerTasks(makeClient(capture), NOW);
    expect(capture.where.status).toEqual({ in: ['RESERVATION', 'APPROVED'] });
    expect(capture.where.date.lt.toISOString()).toBe(businessTomorrowStartUtc(NOW).toISOString());
  });
});
