import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { resolveActor } from '../lib/actor.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  CreateQuotationSchema,
  CreateQuotationVersionSchema,
  RecordQuotationApprovalSchema,
  SendQuotationSchema,
  UpdateQuotationVersionSchema,
  canEditQuotationVersion,
  getCurrentQuotationVersion,
  nextQuotationVersionNumber,
} from '@workforce/shared';
import { z } from 'zod';

const QuotationsListQuerySchema = z.object({
  caseId: z.string().optional(),
});

type RequestUser = { id?: string } | undefined;

async function resolvePerformedBy(user: RequestUser) {
  return resolveActor(user);
}

const quotationWithVersions = {
  versions: {
    include: { sends: { orderBy: { createdAt: 'asc' as const } } },
    orderBy: { versionNumber: 'asc' as const },
  },
  case: { select: { id: true, name: true, customerId: true } },
};

export async function quotationsRoutes(app: FastifyInstance) {
  // List quotations, optionally filtered by case
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const parsed = QuotationsListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid quotations query parameters' });
    }

    const { caseId } = parsed.data;
    return prisma.quotation.findMany({
      where: { ...(caseId ? { caseId } : {}) },
      include: quotationWithVersions,
      orderBy: { updatedAt: 'desc' },
    });
  });

  // Get a single quotation with its full version and send history
  app.get('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: quotationWithVersions,
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });
    return quotation;
  });

  // Preview the current version (flags when dates are not yet final)
  app.get('/:id/preview', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: quotationWithVersions,
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    if (!current) return reply.status(404).send({ error: 'Quotation has no versions' });

    return {
      quotationId: quotation.id,
      caseName: quotation.case.name,
      versionNumber: current.versionNumber,
      status: current.status,
      estimatedTotal: current.estimatedTotal,
      includedServices: current.includedServices,
      datePrecision: current.datePrecision,
      timingNote: current.timingNote,
      validUntil: current.validUntil,
      datesFinal: current.datePrecision === 'EXACT',
    };
  });

  // ── Public, no-auth customer-facing viewer for the shared quotation link ──
  // The quotation id is an unguessable cuid; possession of the link is consent.
  app.get('/:id/public', async (req, reply) => {
    const { id } = req.params as { id: string };
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { versionNumber: 'asc' as const } },
        case: { select: { name: true, customer: { select: { firstName: true } } } },
      },
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    if (!current) return reply.status(404).send({ error: 'Quotation has no versions' });

    return {
      id: quotation.id,
      caseName: quotation.case.name,
      customerFirstName: quotation.case.customer.firstName,
      status: current.status,
      versionNumber: current.versionNumber,
      estimatedTotal: current.estimatedTotal,
      includedServices: current.includedServices,
      datePrecision: current.datePrecision,
      timingNote: current.timingNote,
      validUntil: current.validUntil,
      details: current.details ?? null,
    };
  });

  // Customer approves the sent quotation via the shared link (no auth).
  app.post('/:id/public-approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { versions: true },
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    if (!current) return reply.status(404).send({ error: 'Quotation has no versions' });
    if (current.status === 'APPROVED') {
      return { status: 'APPROVED', alreadyApproved: true };
    }
    if (current.status !== 'SENT') {
      return reply.status(409).send({ error: 'Quotation is not available for approval' });
    }

    const performedBy = await resolveActor(undefined);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.quotationVersion.update({
        where: { id: current.id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvalMethod: 'DIGITAL',
          approvalNotes: 'אושר על ידי הלקוח דרך קישור השיתוף',
        },
      });
      await tx.quotation.update({ where: { id }, data: { status: 'APPROVED' } });
      if (performedBy) {
        await tx.auditLog.create({
          data: {
            performedById: performedBy.id,
            action: 'APPROVE',
            entityType: 'QuotationVersion',
            entityId: current.id,
            newValue: {
              versionNumber: current.versionNumber,
              approvalMethod: 'DIGITAL',
              channel: 'PUBLIC_LINK',
            },
            reason: 'Customer approved via shared link',
          },
        });
      }
    });

    return { status: 'APPROVED' };
  });

  // Create a quotation (with its first draft version) for a project
  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = CreateQuotationSchema.parse(req.body);
    const user = (req as any).user as RequestUser;

    const kase = await prisma.customerCase.findUnique({
      where: { id: body.caseId },
      select: { id: true },
    });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });

    const performedBy = await resolvePerformedBy(user);

    const quotation = await prisma.quotation.create({
      data: {
        caseId: body.caseId,
        status: 'DRAFT',
        versions: {
          create: {
            versionNumber: 1,
            status: 'DRAFT',
            estimatedTotal: body.estimatedTotal,
            includedServices: body.includedServices,
            datePrecision: body.datePrecision ?? 'TO_BE_DETERMINED',
            timingNote: body.timingNote,
            validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
            notes: body.notes,
            details: (body.details ?? undefined) as Prisma.InputJsonValue | undefined,
            createdById: performedBy?.id,
          },
        },
      },
      include: quotationWithVersions,
    });

    reply.status(201);
    return quotation;
  });

  // Edit the current version — only allowed while it is still a draft
  app.patch('/:id/version', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateQuotationVersionSchema.parse(req.body);

    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { versions: true },
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    if (!current) return reply.status(404).send({ error: 'Quotation has no versions' });
    if (!canEditQuotationVersion(current.status)) {
      return reply
        .status(409)
        .send({ error: 'Only draft versions can be edited. Create a new version instead.' });
    }

    await prisma.quotationVersion.update({
      where: { id: current.id },
      data: {
        ...(body.estimatedTotal !== undefined ? { estimatedTotal: body.estimatedTotal } : {}),
        ...(body.includedServices !== undefined ? { includedServices: body.includedServices } : {}),
        ...(body.datePrecision !== undefined ? { datePrecision: body.datePrecision } : {}),
        ...(body.timingNote !== undefined ? { timingNote: body.timingNote } : {}),
        ...(body.validUntil !== undefined ? { validUntil: new Date(body.validUntil) } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.details !== undefined ? { details: body.details as Prisma.InputJsonValue } : {}),
      },
    });

    return prisma.quotation.findUnique({ where: { id }, include: quotationWithVersions });
  });

  // Create a new revised version or addendum (keeps prior versions in history)
  app.post('/:id/versions', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CreateQuotationVersionSchema.parse(req.body);
    const user = (req as any).user as RequestUser;

    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { versions: true },
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    const nextVersion = nextQuotationVersionNumber(quotation.versions);
    const performedBy = await resolvePerformedBy(user);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.quotationVersion.create({
        data: {
          quotationId: id,
          versionNumber: nextVersion,
          status: 'DRAFT',
          estimatedTotal: body.estimatedTotal,
          includedServices: body.includedServices,
          datePrecision: body.datePrecision ?? 'TO_BE_DETERMINED',
          timingNote: body.timingNote,
          validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
          notes: body.notes,
          details: (body.details ?? undefined) as Prisma.InputJsonValue | undefined,
          isAddendum: body.isAddendum ?? false,
          replacesVersionId: current?.id,
          createdById: performedBy?.id,
        },
      });
      await tx.quotation.update({ where: { id }, data: { status: 'DRAFT' } });
    });

    return prisma.quotation.findUnique({ where: { id }, include: quotationWithVersions });
  });

  // Record that the current version was sent to the customer
  app.post('/:id/send', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SendQuotationSchema.parse(req.body);
    const user = (req as any).user as RequestUser;

    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { versions: true },
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    if (!current) return reply.status(404).send({ error: 'Quotation has no versions' });
    if (current.status === 'APPROVED') {
      return reply.status(409).send({ error: 'Approved versions cannot be re-sent as drafts' });
    }

    const performedBy = await resolvePerformedBy(user);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.quotationSend.create({
        data: {
          versionId: current.id,
          channel: body.channel,
          recipient: body.recipient,
          versionNumberSnapshot: current.versionNumber,
          sentById: performedBy?.id,
        },
      });
      if (current.status === 'DRAFT') {
        await tx.quotationVersion.update({
          where: { id: current.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
        await tx.quotation.update({ where: { id }, data: { status: 'SENT' } });
      }
    });

    return prisma.quotation.findUnique({ where: { id }, include: quotationWithVersions });
  });

  // Record customer approval of the current version (version becomes immutable)
  app.post('/:id/approve', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = RecordQuotationApprovalSchema.parse(req.body);
    const user = (req as any).user as RequestUser;

    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { versions: true },
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    if (!current) return reply.status(404).send({ error: 'Quotation has no versions' });
    if (current.status === 'APPROVED') {
      return reply.status(409).send({ error: 'This version is already approved' });
    }

    const performedBy = await resolvePerformedBy(user);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.quotationVersion.update({
        where: { id: current.id },
        data: {
          status: 'APPROVED',
          approvedAt: body.approvedAt ? new Date(body.approvedAt) : new Date(),
          approvalMethod: body.approvalMethod,
          approvalNotes: body.approvalNotes,
          approvalAttachmentUrl: body.approvalAttachmentUrl,
        },
      });
      await tx.quotation.update({ where: { id }, data: { status: 'APPROVED' } });
      if (performedBy) {
        await tx.auditLog.create({
          data: {
            performedById: performedBy.id,
            action: 'APPROVE',
            entityType: 'QuotationVersion',
            entityId: current.id,
            newValue: {
              versionNumber: current.versionNumber,
              approvalMethod: body.approvalMethod,
            },
            reason: 'Quotation approval recorded',
          },
        });
      }
    });

    return prisma.quotation.findUnique({ where: { id }, include: quotationWithVersions });
  });

  // Mark the current version as rejected
  app.post('/:id/reject', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { versions: true },
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    if (!current) return reply.status(404).send({ error: 'Quotation has no versions' });
    if (current.status === 'APPROVED') {
      return reply.status(409).send({ error: 'Approved versions cannot be rejected' });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.quotationVersion.update({ where: { id: current.id }, data: { status: 'REJECTED' } });
      await tx.quotation.update({ where: { id }, data: { status: 'REJECTED' } });
    });

    return prisma.quotation.findUnique({ where: { id }, include: quotationWithVersions });
  });

  // Mark the current version as expired
  app.post('/:id/expire', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const quotation = await prisma.quotation.findUnique({
      where: { id },
      include: { versions: true },
    });
    if (!quotation) return reply.status(404).send({ error: 'Quotation not found' });

    const current = getCurrentQuotationVersion(quotation.versions);
    if (!current) return reply.status(404).send({ error: 'Quotation has no versions' });
    if (current.status === 'APPROVED') {
      return reply.status(409).send({ error: 'Approved versions cannot be expired' });
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.quotationVersion.update({ where: { id: current.id }, data: { status: 'EXPIRED' } });
      await tx.quotation.update({ where: { id }, data: { status: 'EXPIRED' } });
    });

    return prisma.quotation.findUnique({ where: { id }, include: quotationWithVersions });
  });
}
