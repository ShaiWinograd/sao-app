import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { FormSubmissionSchema } from '@workforce/shared';
import { UserRole } from '@workforce/shared';

export async function formsRoutes(app: FastifyInstance) {
  // Submit an end-of-shift form
  app.post('/submit', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const body = FormSubmissionSchema.parse(req.body);

    const shift = await prisma.shift.findUnique({
      where: { id: body.shiftId },
      include: { job: { include: { formTemplate: { include: { questions: true } } } } },
    });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (shift.formStatus === 'SUBMITTED') return reply.status(400).send({ error: 'Form already submitted' });

    const editMinSetting = await prisma.appSetting.findUnique({ where: { key: 'FORM_EDIT_MINUTES' } });
    const now = new Date();
    // Editable until the end of the next day (worker_web_spec §Forms), unless a
    // FORM_EDIT_MINUTES override is configured.
    const editDeadline = editMinSetting
      ? new Date(now.getTime() + Number(editMinSetting.value) * 60 * 1000)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 0, 0, 0);

    const [submission] = await prisma.$transaction([
      prisma.formSubmission.create({
        data: {
          shiftId: body.shiftId,
          completionStatus: body.completionStatus,
          managerNote: body.managerNote,
          editDeadline,
          answers: {
            create: body.answers.map((a) => ({
              questionId: a.questionId,
              value: JSON.stringify(a.value),
            })),
          },
        },
        include: { answers: true },
      }),
      prisma.shift.update({ where: { id: body.shiftId }, data: { formStatus: 'SUBMITTED' } }),
    ]);

    reply.status(201);
    return submission;
  });

  // Worker: edit an already-submitted end-of-shift form within the edit window.
  app.post('/edit', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const body = FormSubmissionSchema.parse(req.body);

    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    const shift = await prisma.shift.findUnique({
      where: { id: body.shiftId },
      include: { formSubmission: true },
    });
    if (!shift || shift.workerId !== worker.id) return reply.status(404).send({ error: 'Shift not found' });
    const submission = shift.formSubmission;
    if (!submission) return reply.status(404).send({ error: 'No submitted form to edit' });
    if (submission.editDeadline && new Date() > submission.editDeadline) {
      return reply.status(409).send({ error: 'The editing window has closed' });
    }

    await prisma.$transaction([
      prisma.formAnswer.deleteMany({ where: { submissionId: submission.id } }),
      prisma.formSubmission.update({
        where: { id: submission.id },
        data: {
          completionStatus: body.completionStatus,
          managerNote: body.managerNote,
          answers: {
            create: body.answers.map((a) => ({ questionId: a.questionId, value: JSON.stringify(a.value) })),
          },
        },
      }),
    ]);

    return { success: true };
  });

  // Get form submission for a shift
  app.get('/for-shift/:shiftId', { preHandler: [authenticate] }, async (req, reply) => {
    const { shiftId } = req.params as { shiftId: string };
    const user = (req as any).user;

    const submission = await prisma.formSubmission.findUnique({
      where: { shiftId },
      include: {
        answers: {
          include: {
            question: true,
          },
        },
      },
    });
    if (!submission) return reply.status(404).send({ error: 'Form not found' });

    // Filter answers by visibility for workers
    if (user.role === UserRole.WORKER) {
      submission.answers = submission.answers.filter(
      (a: any) => a.question.visibility === 'WORKER'
      ) as any;
    }
    return submission;
  });

  // List recent end-of-shift submissions (forms hub)
  app.get('/recent', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const rawLimit = Number((req.query as { limit?: string }).limit ?? 20);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20;

    const submissions = await prisma.formSubmission.findMany({
      include: {
        shift: {
          include: {
            worker: { select: { firstName: true, lastName: true } },
            job: {
              include: {
                case: { select: { name: true, customer: { select: { firstName: true, lastName: true } } } },
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: limit,
    });

    return submissions.map((item: (typeof submissions)[number]) => ({
      id: item.id,
      shiftId: item.shiftId,
      completionStatus: item.completionStatus,
      submittedAt: item.submittedAt,
      managerNote: item.managerNote,
      workerName: `${item.shift.worker.firstName} ${item.shift.worker.lastName}`.trim(),
      customerName: `${item.shift.job.case.customer.firstName} ${item.shift.job.case.customer.lastName}`.trim(),
      caseName: item.shift.job.case.name,
      jobType: item.shift.job.jobType,
      shiftDate: item.shift.job.date,
    }));
  });

  // List linked end-of-shift forms for a case (case hub view)
  app.get('/by-case/:caseId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { caseId } = req.params as { caseId: string };

    const submissions = await prisma.formSubmission.findMany({
      where: { shift: { job: { caseId } } },
      include: {
        shift: {
          include: {
            worker: { select: { firstName: true, lastName: true } },
            job: {
              include: {
                case: { select: { name: true, customer: { select: { firstName: true, lastName: true } } } },
              },
            },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    return submissions.map((item: (typeof submissions)[number]) => ({
      id: item.id,
      shiftId: item.shiftId,
      completionStatus: item.completionStatus,
      submittedAt: item.submittedAt,
      managerNote: item.managerNote,
      workerName: `${item.shift.worker.firstName} ${item.shift.worker.lastName}`.trim(),
      customerName: `${item.shift.job.case.customer.firstName} ${item.shift.job.case.customer.lastName}`.trim(),
      caseName: item.shift.job.case.name,
      jobType: item.shift.job.jobType,
      shiftDate: item.shift.job.date,
    }));
  });

  // Admin: waive a missing form
  app.post('/waive/:shiftId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { shiftId } = req.params as { shiftId: string };
    return prisma.shift.update({ where: { id: shiftId }, data: { formStatus: 'WAIVED' } });
  });

  // List form templates
  app.get('/templates', { preHandler: [authenticate, requireAdmin] }, async (_req, reply) => {
    return prisma.formTemplate.findMany({
      include: { questions: { orderBy: { order: 'asc' } } },
    });
  });

  // Create a form template question (admin)
  app.post('/templates', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = req.body as any;
    const template = await prisma.formTemplate.create({
      data: {
        name: body.name,
        jobType: body.jobType,
        isDefault: body.isDefault ?? false,
        questions: {
          create: (body.questions ?? []).map((q: any, i: number) => ({
            questionText: q.questionText,
            type: q.type,
            visibility: q.visibility ?? 'WORKER',
            isRequired: q.isRequired ?? false,
            order: q.order ?? i,
            options: q.options ?? [],
          })),
        },
      },
      include: { questions: { orderBy: { order: 'asc' } } },
    });
    reply.status(201);
    return template;
  });
}
