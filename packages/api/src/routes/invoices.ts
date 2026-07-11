import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateInvoiceSchema, CustomerPaymentSchema } from '@workforce/shared';
import { money } from '../lib/money.js';

export async function invoicesRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { customerId, caseId, status } = req.query as any;
    return prisma.invoice.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        ...(caseId ? { caseId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true } },
        case: { select: { id: true, name: true } },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  app.get('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { customer: true, case: true, items: true, payments: true },
    });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });
    return invoice;
  });

  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = CreateInvoiceSchema.parse(req.body);
    const { jobIds, ...data } = body;

    const billable = money(data.billableHours);
    const rate = money(data.hourlyRate);
    const fixed = money(data.fixedPrice);
    const fees = money(data.additionalFees);
    const discount = money(data.discount);
    const vatRate = money(data.vatRate ?? 0.18);

    const base = fixed > 0 ? fixed : billable * rate;
    const subtotal = base + fees - discount;
    const vatAmount = subtotal * vatRate;
    const total = subtotal + vatAmount;

    const count = await prisma.invoice.count();
    const invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`;

    const invoice = await prisma.invoice.create({
      data: {
        ...data as any,
        invoiceNumber,
        subtotal,
        vatAmount,
        total,
        items: jobIds
          ? {
              create: jobIds.map((jobId: string) => ({
                jobId,
                description: 'שירות',
                quantity: 1,
                unitPrice: fixed > 0 ? fixed : billable * rate,
                total: fixed > 0 ? fixed : billable * rate,
              })),
            }
          : undefined,
      },
      include: { items: true, payments: true },
    });
    reply.status(201);
    return invoice;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return prisma.invoice.update({ where: { id }, data: req.body as any });
  });

  app.post('/:id/payments', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CustomerPaymentSchema.parse({ ...(req.body as any), invoiceId: id });

    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { payments: true } });
    if (!invoice) return reply.status(404).send({ error: 'Invoice not found' });

    const totalPaid =
      invoice.payments.reduce((s: number, p: any) => s + money(p.amount), 0) + money(body.amount);
    const newStatus = totalPaid >= money(invoice.total) ? 'PAID' : 'PARTIALLY_PAID';

    const [payment] = await prisma.$transaction([
      prisma.customerPayment.create({ data: { ...body, paymentDate: new Date(body.paymentDate) } }),
      prisma.invoice.update({ where: { id }, data: { status: newStatus } }),
    ]);
    reply.status(201);
    return payment;
  });
}
