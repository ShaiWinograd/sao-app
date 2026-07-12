import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  CreatePlannedServiceSchema,
  CreatePlannedServicesFromSelectionSchema,
  UpdatePlannedServiceSchema,
  plannedComponentsForServiceSelection,
} from '@workforce/shared';
import { z } from 'zod';

const PlannedServicesListQuerySchema = z.object({
  caseId: z.string(),
});

export async function plannedServicesRoutes(app: FastifyInstance) {
  // List planned service components for a project
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const parsed = PlannedServicesListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'caseId query parameter is required' });
    }
    return prisma.plannedServiceComponent.findMany({
      where: { caseId: parsed.data.caseId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  // Create a single planned service component for a project
  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const bodySchema = CreatePlannedServiceSchema.extend({ caseId: z.string() });
    const body = bodySchema.parse(req.body);

    const kase = await prisma.customerCase.findUnique({
      where: { id: body.caseId },
      select: { id: true },
    });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });

    const { caseId, ...data } = body;
    const created = await prisma.plannedServiceComponent.create({
      data: { caseId, ...data },
    });
    reply.status(201);
    return created;
  });

  // Create planned components from a high-level wizard selection
  // (e.g. "moving" plans packing + unpacking, never organizing).
  app.post('/from-selection', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const bodySchema = CreatePlannedServicesFromSelectionSchema.extend({ caseId: z.string() });
    const body = bodySchema.parse(req.body);

    const kase = await prisma.customerCase.findUnique({
      where: { id: body.caseId },
      select: { id: true },
    });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });

    const serviceTypes = plannedComponentsForServiceSelection(body.selection);
    if (serviceTypes.length === 0) {
      return reply.status(400).send({ error: 'Selection produced no planned services' });
    }

    await prisma.$transaction(
      serviceTypes.map((serviceType, index) =>
        prisma.plannedServiceComponent.create({
          data: { caseId: body.caseId, serviceType, sortOrder: index },
        }),
      ),
    );

    reply.status(201);
    return prisma.plannedServiceComponent.findMany({
      where: { caseId: body.caseId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  });

  // Update a planned service component
  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdatePlannedServiceSchema.parse(req.body);

    const existing = await prisma.plannedServiceComponent.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Planned service not found' });

    return prisma.plannedServiceComponent.update({ where: { id }, data: body });
  });

  // Delete a planned service component
  app.delete('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const existing = await prisma.plannedServiceComponent.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'Planned service not found' });

    await prisma.plannedServiceComponent.delete({ where: { id } });
    reply.status(204);
    return null;
  });
}
