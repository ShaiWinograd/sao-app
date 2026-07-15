import { prisma } from './prisma.js';
import { UserRole } from '@workforce/shared';

export type ResolvedActor = { id: string; firstName: string; lastName: string };

/**
 * Resolve the user to attribute an action/audit entry to. Order:
 *  1. The authenticated request user (if it exists in the DB).
 *  2. Any active owner/admin.
 *  3. A fallback "system" account, created on demand.
 *
 * This guarantees a non-null actor so audit-logging writes can never hard-fail
 * (previously endpoints returned 500 "No active admin user available for audit
 * logging" on a fresh database).
 */
export async function resolveActor(user?: { id?: string } | null): Promise<ResolvedActor> {
  const existing =
    (user?.id
      ? await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, firstName: true, lastName: true },
        })
      : null) ??
    (await prisma.user.findFirst({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    }));

  if (existing) return existing;

  return prisma.user.upsert({
    where: { id: 'system' },
    update: {},
    create: {
      id: 'system',
      email: 'system@spaceorder.local',
      firstName: 'System',
      lastName: 'Account',
      role: UserRole.OWNER,
      isActive: true,
    },
    select: { id: true, firstName: true, lastName: true },
  });
}
