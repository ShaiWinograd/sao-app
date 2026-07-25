// Quick Create job orchestration (spec §6.1). Extracted so the route AND its tests
// execute the SAME implementation — the ordering guarantees below are not merely
// "mirrored" in a test helper.
//
// Ordering (idempotency- and orphan-safe):
//   1. Fast-path replay lookup by idempotency key — BEFORE any address/token
//      validation or write. A replay returns the original job and performs no
//      customer/case/address writes and no audit/notification side effects.
//   2. Address resolution (token/provider work) — OUTSIDE the transaction because
//      it performs no DB writes; throwing here writes nothing.
//   3. A single transaction that, AFTER acquiring the idempotency advisory lock and
//      re-checking, performs EVERY write: resolve/create the customer, resolve the
//      case, create the address, and create the job + slots. This guarantees two
//      concurrent first submissions with the same key can never leave an orphan
//      customer/case/address — exactly one job is created and everything else
//      rolls back together on any failure.

import { GENERAL_RESERVATION_CUSTOMER_ID, MANAGER_SKILL } from '@workforce/shared';
import type { Job } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { lockIdempotencyKey } from '../lib/commitment.js';
import { resolveOrCreateCaseForJob } from './caseResolution.js';
import { resolveQuickCreateAddress, type AddressInput } from './quickCreateAddress.js';
import type { GeocodeProvider } from '../lib/geocoding/types.js';

export interface QuickJobInput {
  customerMode?: 'EXISTING' | 'NEW' | 'GENERAL_RESERVATION';
  customerId?: string;
  newCustomer?: { firstName: string; lastName?: string; phone?: string; email?: string };
  generalReservation?: boolean;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: string;
  startTime: string;
  endTime: string;
  cityOrAddress?: string;
  address?: AddressInput;
  requiredWorkerCount: number;
  requiresTeamLeader?: boolean;
  initialStatus?: 'RESERVATION' | 'APPROVED';
  notes?: string;
  idempotencyKey?: string;
}

export interface CreateQuickJobDeps {
  provider: GeocodeProvider | null;
  secret: string | null;
  actor?: { id?: string } | null;
  now?: Date;
}

export interface CreateQuickJobResult {
  job: Job & { slots?: unknown[] };
  idempotentReplay: boolean;
}

export async function createQuickJob(
  client: typeof prisma,
  body: QuickJobInput,
  deps: CreateQuickJobDeps,
): Promise<CreateQuickJobResult> {
  // (1) Fast-path replay — before any address/token validation or write.
  if (body.idempotencyKey) {
    const existing = await client.job.findFirst({ where: { idempotencyKey: body.idempotencyKey }, include: { slots: true } });
    if (existing) return { job: existing, idempotentReplay: true };
  }

  // (2) Resolve the address (token/provider work; NO DB writes). Throws on a bad
  //     selection → nothing is written and no customer is created.
  const resolvedAddress = await resolveQuickCreateAddress(
    { address: body.address, cityOrAddress: body.cityOrAddress },
    { provider: deps.provider, secret: deps.secret, now: deps.now },
  );

  // (3) Read-only prep (no writes).
  const dateOnly = body.date.slice(0, 10);
  const parsedDate = new Date(`${dateOnly}T00:00:00.000Z`);
  const plannedStart = new Date(`${dateOnly}T${body.startTime}:00.000Z`);
  const plannedEnd = new Date(`${dateOnly}T${body.endTime}:00.000Z`);
  const defaultTemplate = await client.formTemplate.findFirst({ where: { jobType: body.jobType, isDefault: true }, select: { id: true } });
  const teamLeaderSlots = body.requiresTeamLeader ? 1 : 0;

  // (4) EVERY write happens here, AFTER the idempotency lock + recheck.
  const result = await client.$transaction(async (tx) => {
    if (body.idempotencyKey) {
      await lockIdempotencyKey(tx, body.idempotencyKey);
      const existing = await tx.job.findFirst({ where: { idempotencyKey: body.idempotencyKey }, include: { slots: true } });
      if (existing) return { job: existing, replay: true as const };
    }

    // Resolve/create the customer INSIDE the transaction so a concurrent first
    // submission can never leave an orphan customer.
    let customerId: string;
    let caseName: string;
    const wantsGeneralReservation = body.generalReservation === true || body.customerMode === 'GENERAL_RESERVATION';
    if (wantsGeneralReservation) {
      customerId = GENERAL_RESERVATION_CUSTOMER_ID;
      const c = await tx.customer.findUnique({ where: { id: customerId }, select: { firstName: true, lastName: true } });
      caseName = `${c?.firstName ?? ''} ${c?.lastName ?? ''}`.trim();
    } else if (body.customerId) {
      const c = await tx.customer.findUnique({ where: { id: body.customerId }, select: { id: true, firstName: true, lastName: true } });
      if (!c) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
      customerId = c.id;
      caseName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    } else if (body.newCustomer?.firstName) {
      const created = await tx.customer.create({
        data: {
          firstName: body.newCustomer.firstName,
          lastName: body.newCustomer.lastName ?? '',
          phone: body.newCustomer.phone ?? '-',
          email: body.newCustomer.email?.trim() || null,
        },
        select: { id: true, firstName: true, lastName: true },
      });
      customerId = created.id;
      caseName = `${created.firstName ?? ''} ${created.lastName ?? ''}`.trim();
    } else {
      throw new AppError(400, 'CUSTOMER_REQUIRED', 'יש לבחור לקוח/ת קיים, למלא לקוח/ת חדש/ה, או לסמן שריון כללי.');
    }

    const caseId = await resolveOrCreateCaseForJob(tx, {
      customerId,
      caseName,
      newJobDate: parsedDate,
      actor: deps.actor ?? null,
    });

    const address = await tx.address.create({
      data: { customerId, fullAddress: resolvedAddress.fullAddress, label: 'OTHER', ...(resolvedAddress.apply ?? {}) },
    });

    const job = await tx.job.create({
      data: {
        caseId,
        customerId,
        addressId: address.id,
        jobType: body.jobType,
        date: parsedDate,
        plannedStart,
        plannedEnd,
        requiredWorkerCount: body.requiredWorkerCount,
        jobNotes: body.notes ?? null,
        formTemplateId: defaultTemplate?.id ?? null,
        status: body.initialStatus ?? 'RESERVATION',
        idempotencyKey: body.idempotencyKey ?? null,
        slots: {
          create: [
            ...(teamLeaderSlots ? [{ requiredSkill: MANAGER_SKILL as any }] : []),
            ...Array.from({ length: Math.max(0, body.requiredWorkerCount - teamLeaderSlots) }, () => ({ requiredSkill: null })),
          ],
        },
      },
      include: { slots: true },
    });
    return { job, replay: false as const };
  });

  return { job: result.job, idempotentReplay: result.replay };
}
