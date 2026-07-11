import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateAddressSchema } from '@workforce/shared';

export async function addressesRoutes(app: FastifyInstance) {
  app.get('/for-customer/:customerId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { customerId } = req.params as { customerId: string };
    return prisma.address.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
  });

  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = CreateAddressSchema.parse(req.body);
    const address = await prisma.address.create({ data: body as any });
    reply.status(201);
    return address;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const address = await prisma.address.update({ where: { id }, data: req.body as any });
    return address;
  });
}
