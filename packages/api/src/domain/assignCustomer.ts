// Assign a real customer to a General-Reservation job (spec §10.1).
//
// V1 slice: only the General-Reservation → real-customer direction. Guards:
// owner-only (enforced by the route's requireAdmin preHandler); the source job
// must currently belong to the system (General Reservation) customer; the target
// must be a real, non-system customer; and the job must be pre-attendance.
//
// The shared GR address row is NEVER mutated. An equivalent address already under
// the target customer is reused, otherwise the GR address is cloned into a new row
// for the target (geocode metadata intentionally reset to the NOT_REQUESTED
// default so monitoring never activates from a stale, unvalidated coordinate).
// Project grouping uses the shared 60-day active-case resolver. The customer swap,
// address move, case (re)grouping and audit all commit in one transaction; a
// throw rolls the whole change back. Assigned and pending workers are notified
// afterwards (no re-approval, §11.2 "Customer only"); the empty GR case is left
// intact.
import type { Job } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { lockJob } from '../lib/commitment.js';
import { resolveOrCreateCaseForJob } from './caseResolution.js';

export type AssignCustomerResult = {
  job: Job;
  caseId: string;
  addressId: string | null;
  notifiedUserIds: string[];
};

const NOTIFY_STATUSES = ['APPROVED', 'PENDING', 'AWAITING_WORKER'] as const;

export async function assignRealCustomerToJob(
  client: typeof prisma,
  params: { jobId: string; customerId: string; actor?: { id?: string } | null },
): Promise<AssignCustomerResult> {
  const job = await client.job.findUnique({
    where: { id: params.jobId },
    select: {
      id: true,
      status: true,
      date: true,
      caseId: true,
      addressId: true,
      customerId: true,
      customer: { select: { isSystem: true } },
      address: {
        select: { fullAddress: true, apartmentDetails: true, label: true, accessNotes: true, parkingNotes: true, elevatorNotes: true },
      },
      shifts: { select: { attendanceStatus: true } },
    },
  });
  if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  if (!job.customer.isSystem) {
    throw new AppError(409, 'NOT_GENERAL_RESERVATION', 'רק עבודה בשריון כללי ניתנת לשיוך ללקוח.');
  }
  if (job.status === 'COMPLETED' || job.status === 'ARCHIVED') {
    throw new AppError(409, 'JOB_CLOSED', 'לא ניתן לשייך לקוח לעבודה שהושלמה או הוסרה.');
  }
  if (job.shifts.some((s) => s.attendanceStatus !== 'SCHEDULED')) {
    throw new AppError(409, 'ATTENDANCE_STARTED', 'לא ניתן לשייך לקוח לאחר תחילת נוכחות בעבודה.');
  }

  const target = await client.customer.findUnique({
    where: { id: params.customerId },
    select: { id: true, firstName: true, lastName: true, isSystem: true },
  });
  if (!target) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  if (target.isSystem) {
    throw new AppError(409, 'TARGET_IS_SYSTEM', 'יש לבחור לקוח אמיתי (לא שריון כללי).');
  }

  const caseName = `${target.firstName} ${target.lastName}`.trim();

  const { updated, newCaseId, addressId } = await client.$transaction(async (tx) => {
    await lockJob(tx, params.jobId);

    // Resolve the address WITHOUT mutating the shared GR row.
    let addressId = job.addressId;
    if (job.addressId && job.address) {
      const src = job.address;
      const equivalent = await tx.address.findFirst({
        where: {
          customerId: target.id,
          fullAddress: src.fullAddress,
          label: src.label,
          apartmentDetails: src.apartmentDetails ?? null,
        },
        select: { id: true },
      });
      if (equivalent) {
        addressId = equivalent.id;
      } else {
        const cloned = await tx.address.create({
          data: {
            customerId: target.id,
            fullAddress: src.fullAddress,
            apartmentDetails: src.apartmentDetails,
            label: src.label,
            accessNotes: src.accessNotes,
            parkingNotes: src.parkingNotes,
            elevatorNotes: src.elevatorNotes,
          },
          select: { id: true },
        });
        addressId = cloned.id;
      }
    }

    const newCaseId = await resolveOrCreateCaseForJob(tx, {
      customerId: target.id,
      caseName,
      newJobDate: job.date,
      actor: params.actor,
    });

    const updated = await tx.job.update({
      where: { id: params.jobId },
      data: { customerId: target.id, caseId: newCaseId, addressId },
    });

    await logAudit(
      params.actor ?? null,
      'UPDATE',
      'Job',
      params.jobId,
      { customerId: job.customerId, caseId: job.caseId, addressId: job.addressId },
      { customerId: target.id, caseId: newCaseId, addressId },
      'assign-customer',
      tx,
    );

    return { updated, newCaseId, addressId };
  });

  // §11.2 "Customer only" → notify assigned AND pending workers; no re-approval.
  const involved = await client.shift.findMany({
    where: { jobId: params.jobId, joinRequestStatus: { in: [...NOTIFY_STATUSES] } },
    select: { worker: { select: { userId: true } } },
  });
  const notifiedUserIds = Array.from(new Set(involved.map((s) => s.worker.userId)));
  if (notifiedUserIds.length) {
    const dk = job.date.toISOString().slice(0, 10);
    await client.notification.createMany({
      data: notifiedUserIds.map((userId) => ({
        userId,
        title: 'עודכן לקוח העבודה',
        body: `העבודה בתאריך ${dk} שויכה ללקוח ${caseName}. אין צורך באישור מחדש.`,
        data: { type: 'JOB_CUSTOMER_ASSIGNED', jobId: params.jobId } as any,
      })),
    });
  }

  return { job: updated, caseId: newCaseId, addressId, notifiedUserIds };
}
