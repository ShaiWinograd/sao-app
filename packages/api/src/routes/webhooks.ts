import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { UserRole } from '@workforce/shared';
import { createClerkClient } from '@clerk/clerk-sdk-node';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

/**
 * Clerk webhook — syncs new users to the database.
 * Configure in Clerk dashboard: user.created, user.updated events → /webhooks/clerk
 */
export async function webhooksRoutes(app: FastifyInstance) {
  app.post('/clerk', async (req, reply) => {
    // In production, verify the Clerk webhook signature using svix
    const event = req.body as any;

    if (event.type === 'user.created') {
      const { id, email_addresses, first_name, last_name, public_metadata } = event.data;
      const email = email_addresses[0]?.email_address;
      const role = (public_metadata?.role as UserRole) ?? UserRole.WORKER;

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
      const email = email_addresses[0]?.email_address;
      await prisma.user.updateMany({
        where: { id },
        data: { email, firstName: first_name ?? '', lastName: last_name ?? '' },
      });
    }

    return { received: true };
  });
}
