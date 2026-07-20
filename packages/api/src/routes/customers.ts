import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateCustomerSchema, UpdateCustomerSchema } from '@workforce/shared';

export async function customersRoutes(app: FastifyInstance) {
  // List all customers (admin/owner)
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { search } = req.query as { search?: string };
    const customers = await prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: {
        addresses: {
          select: {
            id: true,
            label: true,
            fullAddress: true,
            apartmentDetails: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        cases: {
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return customers;
  });

  // Get single customer
  app.get('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        addresses: true,
        cases: { include: { jobs: true }, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!customer) return reply.status(404).send({ error: 'Customer not found' });
    return customer;
  });

  // Create customer
  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = CreateCustomerSchema.parse(req.body);
    const customer = await prisma.customer.create({ data: body });
    reply.status(201);
    return customer;
  });

  // Update customer
  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateCustomerSchema.parse(req.body);
    const customer = await prisma.customer.update({ where: { id }, data: body });
    return customer;
  });

  // Check for duplicates before creation
  app.post('/check-duplicate', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { phone, email, firstName, lastName } = req.body as any;
    const duplicates = await prisma.customer.findMany({
      where: {
        OR: [
          phone ? { phone } : undefined,
          email ? { email } : undefined,
          firstName && lastName ? { firstName, lastName } : undefined,
        ].filter(Boolean) as any[],
      },
    });
    return { duplicates };
  });

  // Deactivate customer (soft delete)
  app.delete('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const customer = await prisma.customer.findUnique({ where: { id }, select: { isSystem: true } });
    if (!customer) return reply.status(404).send({ error: 'Customer not found' });
    if (customer.isSystem) {
      return reply.status(409).send({ error: 'לא ניתן למחוק לקוח מערכת (שריון כללי).' });
    }
    await prisma.customer.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  });
}
