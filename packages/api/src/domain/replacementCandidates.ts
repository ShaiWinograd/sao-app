import { formatJobTime, isUnavailableDuring } from '@workforce/shared';
import { prisma } from '../lib/prisma.js';

export async function findEligibleReplacementCandidates(shiftId: string, requesterWorkerId: string) {
  const shift = await prisma.shift.findFirst({
    where: { id: shiftId, workerId: requesterWorkerId },
    select: {
      job: {
        select: {
          date: true,
          plannedStart: true,
          plannedEnd: true,
        },
      },
    },
  });
  if (!shift) return null;

  const workers = await prisma.worker.findMany({
    where: { isActive: true, id: { not: requesterWorkerId } },
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      availability: {
        select: {
          type: true,
          startDate: true,
          endDate: true,
          weekday: true,
          startTime: true,
          endTime: true,
        },
      },
      shifts: {
        where: {
          joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] },
          job: { date: shift.job.date },
        },
        select: { id: true },
      },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  const dateKey = shift.job.date.toISOString().slice(0, 10);
  const startTime = formatJobTime(shift.job.plannedStart);
  const endTime = formatJobTime(shift.job.plannedEnd);

  return workers
    .filter((candidate) => {
      if (candidate.shifts.length > 0) return false;
      const blocks = candidate.availability.map((block) => ({
        type: block.type,
        startDate: block.startDate?.toISOString() ?? null,
        endDate: block.endDate?.toISOString() ?? null,
        weekday: block.weekday,
        startTime: block.startTime,
        endTime: block.endTime,
      }));
      return !isUnavailableDuring(blocks, dateKey, startTime, endTime);
    })
    .map((candidate) => ({
      id: candidate.id,
      userId: candidate.userId,
      name: `${candidate.firstName} ${candidate.lastName}`.trim(),
    }));
}
