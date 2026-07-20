import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { prisma } from './lib/prisma.js';
import { CommitmentConflictError } from './lib/commitment.js';
import { AppError } from './lib/errors.js';

// Route plugins
import { customersRoutes } from './routes/customers.js';
import { casesRoutes } from './routes/cases.js';
import { addressesRoutes } from './routes/addresses.js';
import { jobsRoutes } from './routes/jobs.js';
import { shiftsRoutes } from './routes/shifts.js';
import { attendanceRoutes } from './routes/attendance.js';
import { formsRoutes } from './routes/forms.js';
import { workerPayrollRoutes } from './routes/workerPayroll.js';
import { workersRoutes } from './routes/workers.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';
import { expensesRoutes } from './routes/expenses.js';
import { reportsRoutes } from './routes/reports.js';
import { settingsRoutes } from './routes/settings.js';
import { notificationsRoutes } from './routes/notifications.js';
import { auditRoutes } from './routes/audit.js';
import { webhooksRoutes } from './routes/webhooks.js';
import { schedulerRoutes } from './routes/scheduler.js';

const PORT = Number(process.env.API_PORT ?? 3001);

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/$/, '').toLowerCase();
}

function isAllowedOrigin(origin: string, allowedOrigins: Set<string>) {
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.has(normalized)) return true;

  // Allow deployed web frontends and Expo preview origins.
  if (/^https:\/\/[a-z0-9-]+\.azurewebsites\.net$/i.test(normalized)) return true;
  if (normalized.includes('expo-')) return true;

  return false;
}

async function build() {
  const app = Fastify({ logger: { level: 'info' } });

  // Tolerate requests whose Content-Type has no dedicated parser (e.g. a DELETE
  // that a browser/axios sends with a stray Content-Type but no body). Without
  // this, Fastify rejects them with "Unsupported Media Type", which our error
  // handler turns into a 500. JSON bodies still use the built-in JSON parser.
  app.addContentTypeParser('*', (_req, payload, done) => {
    let data = '';
    payload.on('data', (chunk) => {
      data += chunk;
    });
    payload.on('end', () => done(null, data.length ? data : undefined));
    payload.on('error', done);
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Invalid request data',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    // Same-day commitment guard conflict (§12.1, §13) — 409 with the rule code.
    if (error instanceof CommitmentConflictError) {
      return reply.status(409).send({ error: error.code, message: error.message });
    }

    // Typed, exposable staffing/domain errors (e.g. capacity/leader/backup decisions).
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message, ...(error.data ?? {}) });
    }

    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply.status(409).send({ error: 'Duplicate value violates a unique constraint' });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({ error: 'Requested resource was not found' });
      }
      req.log.error({ err: error }, 'Prisma request error');
      return reply.status(400).send({ error: 'Database request failed', code: error.code });
    }

    req.log.error({ err: error }, 'Unhandled API error');
    return reply.status(500).send({ error: 'Unexpected server error' });
  });

  const extraOrigins = (process.env.CORS_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const configuredOrigins = [
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    ...extraOrigins,
  ]
    .map(normalizeOrigin)
    .filter(Boolean);

  const allowedOrigins = new Set(configuredOrigins);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Non-browser clients (no Origin header) are allowed.
      if (!origin) {
        cb(null, true);
        return;
      }

      if (isAllowedOrigin(origin, allowedOrigins)) {
        cb(null, true);
        return;
      }

      cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  await app.register(jwt, {
    secret: process.env.API_JWT_SECRET ?? 'dev-secret-change-me',
  });

  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB

  // Health check
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // API routes (versioned)
  const prefix = '/api/v1';
  await app.register(customersRoutes,      { prefix: `${prefix}/customers` });
  await app.register(casesRoutes,          { prefix: `${prefix}/cases` });
  await app.register(addressesRoutes,      { prefix: `${prefix}/addresses` });
  await app.register(jobsRoutes,           { prefix: `${prefix}/jobs` });
  await app.register(shiftsRoutes,         { prefix: `${prefix}/shifts` });
  await app.register(attendanceRoutes,     { prefix: `${prefix}/attendance` });
  await app.register(formsRoutes,          { prefix: `${prefix}/forms` });
  await app.register(workerPayrollRoutes,  { prefix: `${prefix}/payroll` });
  await app.register(workersRoutes,        { prefix: `${prefix}/workers` });
  await app.register(meRoutes,             { prefix: `${prefix}/auth` });
  await app.register(expensesRoutes,       { prefix: `${prefix}/expenses` });
  await app.register(reportsRoutes,        { prefix: `${prefix}/reports` });
  await app.register(settingsRoutes,       { prefix: `${prefix}/settings` });
  await app.register(notificationsRoutes,  { prefix: `${prefix}/notifications` });
  await app.register(adminRoutes,          { prefix: `${prefix}/admin` });
  await app.register(auditRoutes,          { prefix: `${prefix}/audit` });
  await app.register(schedulerRoutes,      { prefix: `${prefix}/scheduler` });
  await app.register(webhooksRoutes,       { prefix: `/webhooks` });

  return app;
}

async function start() {
  const app = await build();
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`🚀 API listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

start();
