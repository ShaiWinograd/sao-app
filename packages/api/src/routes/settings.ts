import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireOwner, requireAdmin } from '../middleware/auth.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (_req, reply) => {
    return prisma.appSetting.findMany();
  });

  app.patch('/:key', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { key } = req.params as { key: string };
    const { value } = req.body as { value: string };
    return prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  });
}
