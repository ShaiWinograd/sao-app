import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { UserRole } from '@workforce/shared';
import { createClerkClient } from '@clerk/clerk-sdk-node';
import { decideAuthorizedRole, shouldLogAuthorizationDenied } from '../lib/authorize.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

/**
 * Clerk webhook — syncs new users to the database.
 * Configure in Clerk dashboard: user.created, user.updated events → /webhooks/clerk
 */
export async function webhooksRoutes(app: FastifyInstance) {
  app.post('/clerk', async (req, reply) => {
    // NOTE: this endpoint is not signature-verified, so the request body is
    // UNTRUSTED. We therefore never assign a role from the payload's metadata —
    // authorization is resolved only from trusted sources (Clerk-API metadata +
    // a pre-registered Worker match), exactly like the auth middleware.
    const event = req.body as any;

    if (event.type === 'user.created') {
      const { id, email_addresses, first_name, last_name } = event.data;
      const email = email_addresses?.[0]?.email_address ?? '';

      // Re-read the role from the Clerk API (trusted), not from the payload.
      let metaRole: UserRole | undefined;
      try {
        const clerkUser = await clerk.users.getUser(id);
        metaRole = clerkUser.publicMetadata?.role as UserRole | undefined;
      } catch {
        metaRole = undefined;
      }
      const matchedWorker = email
        ? await prisma.worker.findUnique({ where: { email }, select: { id: true } })
        : null;
      const role = decideAuthorizedRole({ metaRole, hasWorkerMatch: Boolean(matchedWorker) });

      if (!role) {
        // Unknown signup — never create a User/Worker business profile.
        if (shouldLogAuthorizationDenied(id)) {
          req.log.warn(
            { event: 'authorization_denied', userId: id, source: 'webhook' },
            'Ignored user.created for an unauthorized identity',
          );
        }
        return { received: true, authorized: false };
      }

      await prisma.user.upsert({
        where: { id },
        update: { email, firstName: first_name ?? '', lastName: last_name ?? '', role },
        create: {
          id,
          email,
          firstName: first_name ?? '',
          lastName: last_name ?? '',
          role,
          isActive: true,
        },
      });
    }

    if (event.type === 'user.updated') {
      const { id, email_addresses, first_name, last_name } = event.data;
      const email = email_addresses?.[0]?.email_address;
      // Only updates existing users (never creates) and never changes the role.
      await prisma.user.updateMany({
        where: { id },
        data: { email, firstName: first_name ?? '', lastName: last_name ?? '' },
      });
    }

    return { received: true };
  });
}

