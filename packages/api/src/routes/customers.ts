import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateCustomerSchema, UpdateCustomerSchema } from '@workforce/shared';
import { z } from 'zod';

const QuoteSchema = z.object({
  identifierType: z.enum(['ISRAELI_ID', 'COMPANY_NUMBER']),
  identifierNumber: z.string().regex(/^\d{9}$/),
  jobIds: z.array(z.string()).min(1).refine((ids) => new Set(ids).size === ids.length, 'Duplicate jobs are not allowed'),
  totalAmount: z.number().positive(),
  notes: z.string().max(2000).optional(),
});

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
          orderBy: { updatedAt: 'desc' },
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
      orderBy: { updatedAt: 'desc' },
    });

    return customers;
  });

  app.get('/:id/quote-context', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        identifierType: true,
        identifierNumber: true,
        addresses: {
          select: { fullAddress: true },
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        jobs: {
          where: { status: { not: 'ARCHIVED' } },
          select: {
            id: true,
            date: true,
            plannedStart: true,
            jobType: true,
            status: true,
            address: { select: { fullAddress: true } },
          },
          orderBy: { plannedStart: 'desc' },
        },
      },
    });
    if (!customer) return reply.status(404).send({ error: 'Customer not found' });

    return {
      customerName: `${customer.firstName} ${customer.lastName}`.trim(),
      email: customer.email,
      phone: customer.phone,
      address: customer.jobs[0]?.address.fullAddress ?? customer.addresses[0]?.fullAddress ?? '',
      identifierType: customer.identifierType,
      identifierNumber: customer.identifierNumber,
      jobs: customer.jobs,
    };
  });

  app.get('/:id/quotes', { preHandler: [authenticate, requireAdmin] }, async (req) => {
    const { id } = req.params as { id: string };
    return prisma.customerQuote.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.post('/:id/quotes', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = QuoteSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        jobs: {
          where: { id: { in: body.jobIds }, status: { not: 'ARCHIVED' } },
          select: {
            id: true,
            plannedStart: true,
            address: { select: { fullAddress: true } },
          },
          orderBy: { plannedStart: 'desc' },
        },
      },
    });
    if (!customer) return reply.status(404).send({ error: 'Customer not found' });
    if (customer.jobs.length !== new Set(body.jobIds).size) {
      return reply.status(400).send({ error: 'Quote jobs must belong to the customer and remain active' });
    }

    const quote = await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          identifierType: body.identifierType,
          identifierNumber: body.identifierNumber,
        },
      });
      return tx.customerQuote.create({
        data: {
          customerId: id,
          customerName: `${customer.firstName} ${customer.lastName}`.trim(),
          customerEmail: customer.email,
          customerPhone: customer.phone,
          customerAddress: customer.jobs[0]?.address.fullAddress ?? '',
          identifierType: body.identifierType,
          identifierNumber: body.identifierNumber,
          jobIds: body.jobIds,
          totalAmount: body.totalAmount,
          notes: body.notes?.trim() || null,
        },
      });
    });
    reply.status(201);
    return quote;
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
