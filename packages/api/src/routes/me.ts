import { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

// Authoritative identity for the signed-in user, sourced from the DB (not Clerk
// metadata). The web app uses this to decide where to land after sign-in so a
// worker is never routed into the owner dashboard.
export async function meRoutes(app: FastifyInstance) {
  app.get('/me', { preHandler: [authenticate] }, async (req) => {
    const user = (req as any).user;
    return { id: user.id, role: user.role };
  });
}
