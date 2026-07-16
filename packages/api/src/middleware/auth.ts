import { FastifyRequest, FastifyReply } from 'fastify';
import { createClerkClient } from '@clerk/clerk-sdk-node';
import { prisma } from '../lib/prisma.js';
import { UserRole } from '@workforce/shared';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const shouldEnforceApiAuth = process.env.ENABLE_API_AUTH === 'true';

/** Attach the Clerk user + DB User to the request */
export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  if (!shouldEnforceApiAuth) {
    (req as any).user = {
      id: 'dev-owner',
      role: UserRole.OWNER,
      isActive: true,
      firstName: 'Dev',
      lastName: 'Owner',
      email: 'dev-owner@spaceorder.local',
    };
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);

  try {
    const payload = await clerk.verifyToken(token);

    // Auto-provision user on first login (no webhook required)
    let dbUser = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!dbUser) {
      try {
        const clerkUser = await clerk.users.getUser(payload.sub);
        const email = clerkUser.emailAddresses[0]?.emailAddress ?? '';
        // If an admin already created a worker profile with this email, onboard
        // this login as that worker (role WORKER + link the profile to the Clerk
        // user so `/workers/me` resolves). Otherwise fall back to Clerk metadata
        // (default OWNER). This only runs on first login, so it never changes an
        // existing user's role.
        const matchedWorker = email
          ? await prisma.worker.findUnique({ where: { email }, select: { id: true, userId: true } })
          : null;
        const role = matchedWorker
          ? UserRole.WORKER
          : ((clerkUser.publicMetadata?.role as UserRole) ?? UserRole.OWNER);

        // A worker added via the admin page has a placeholder user holding this
        // email (User.email is unique). Free that email so the real Clerk account
        // can claim it, otherwise the create below fails with a unique violation.
        if (email) {
          const placeholder = await prisma.user.findUnique({ where: { email }, select: { id: true } });
          if (placeholder && placeholder.id !== payload.sub) {
            await prisma.user.update({
              where: { id: placeholder.id },
              data: { email: `migrated+${placeholder.id}@spaceorder.local`, isActive: false },
            });
          }
        }

        dbUser = await prisma.user.upsert({
          where: { id: payload.sub },
          update: { email, firstName: clerkUser.firstName ?? '', lastName: clerkUser.lastName ?? '' },
          create: {
            id: payload.sub,
            email,
            firstName: clerkUser.firstName ?? '',
            lastName: clerkUser.lastName ?? '',
            role,
            isActive: true,
          },
        });
        if (matchedWorker && matchedWorker.userId !== dbUser.id) {
          // Point the worker profile at the real Clerk user, then drop the now
          // orphaned placeholder user (best-effort; it has no other references).
          const orphanUserId = matchedWorker.userId;
          await prisma.worker.update({ where: { id: matchedWorker.id }, data: { userId: dbUser.id } });
          if (orphanUserId) {
            await prisma.user.delete({ where: { id: orphanUserId } }).catch(() => {});
          }
        }
        // Keep Clerk metadata in sync so the web app's role-based UI is correct.
        if (role === UserRole.WORKER) {
          await clerk.users
            .updateUserMetadata(dbUser.id, { publicMetadata: { role: UserRole.WORKER } })
            .catch(() => undefined);
        }
        req.log.info({ userId: payload.sub, role }, 'Auto-provisioned new user from Clerk');
      } catch (provisionErr) {
        req.log.error({ err: provisionErr }, 'Failed to auto-provision user');
        return reply.status(401).send({ error: 'User not found' });
      }
    }

    if (!dbUser.isActive) {
      return reply.status(401).send({ error: 'User is inactive' });
    }
    (req as any).user = dbUser;
  } catch {
    return reply.status(401).send({ error: 'Invalid token' });
  }
}

/** Require one of the given roles */
export function requireRole(...roles: UserRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user;
    if (!user || !roles.includes(user.role)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
  };
}

/** Require Owner role */
export const requireOwner = requireRole(UserRole.OWNER);

/** Require Owner or Admin */
export const requireAdmin = requireRole(UserRole.OWNER, UserRole.ADMIN);

/** Require Owner, Admin, or Worker */
export const requireAnyRole = requireRole(UserRole.OWNER, UserRole.ADMIN, UserRole.WORKER);

/** Worker can only access their own resources */
export function requireSelfOrAdmin(getWorkerId: (req: FastifyRequest) => string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = (req as any).user;
    if (user.role === UserRole.WORKER) {
      const workerId = getWorkerId(req);
      const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
      if (!worker || worker.id !== workerId) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
    }
  };
}
