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
        const role = (clerkUser.publicMetadata?.role as UserRole) ?? UserRole.OWNER;
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
