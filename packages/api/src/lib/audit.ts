import { prisma } from './prisma.js';
import { resolveActor } from './actor.js';

export type AuditActionType = 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT';

/**
 * Write an audit log entry attributed to the acting user (integration spec §23/§26).
 * Uses resolveActor so a missing/unknown user never hard-fails the request.
 */
export async function logAudit(
  user: { id?: string } | null | undefined,
  action: AuditActionType,
  entityType: string,
  entityId: string,
  previousValue?: unknown,
  newValue?: unknown,
  reason?: string,
): Promise<void> {
  const actor = await resolveActor(user ?? null);
  await prisma.auditLog.create({
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
