import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { resolveActor } from './actor.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export type AuditActionType =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'APPROVE'
  | 'REJECT'
  | 'CLOCK_IN'
  | 'CLOCK_OUT'
  | 'AUTO_CLOCK_OUT'
  | 'CORRECTION';

/**
 * Write an audit log entry attributed to the acting user (integration spec §23/§26).
 * Uses resolveActor so a missing/unknown user never hard-fails the request. Pass a
 * transaction client so the audit row is written in the same transaction as the
 * state change (and rolls back with it on failure).
 */
export async function logAudit(
  user: { id?: string } | null | undefined,
  action: AuditActionType,
  entityType: string,
  entityId: string,
  previousValue?: unknown,
  newValue?: unknown,
  reason?: string,
  client: DbClient = prisma,
): Promise<void> {
  const actor = await resolveActor(user ?? null, client);
  await client.auditLog.create({
    data: {
      performedById: actor.id,
      action,
      entityType,
      entityId,
      previousValue: (previousValue ?? undefined) as any,
      newValue: (newValue ?? undefined) as any,
      reason: reason ?? null,
    },
  });
}
