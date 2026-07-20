import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { runAttendanceSweep } from '../domain/attendanceSweep.js';

// Protected internal sweep endpoint (spec §16.2, §16.4, §17.3). Driven by an
// external scheduled trigger (Azure Timer Function) every minute — NOT an
// in-process interval, so app restarts / deployments / recycling never skip
// time-based actions. It only ORCHESTRATES the domain services; the rules live in
// domain/attendanceSweep. Authenticated by a dedicated shared secret and never
// reachable from ordinary owner/worker sessions.
export async function internalSweepRoutes(app: FastifyInstance) {
  app.post('/attendance', async (req, reply) => {
    const secret = process.env.INTERNAL_SWEEP_SECRET;
    if (!secret) return reply.status(503).send({ error: 'Sweep not configured' });
    // Dedicated secret via a header ordinary Clerk sessions never send.
    if (req.headers['x-internal-secret'] !== secret) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    // Dry-run is a diagnostic aid and is refused in production so it can never be
    // used to probe/no-op the real schedule.
    const body = (req.body ?? {}) as { dryRun?: boolean; now?: string };
    const dryRun = Boolean(body.dryRun);
    if (dryRun && process.env.NODE_ENV === 'production') {
      return reply.status(400).send({ error: 'dry-run is not allowed in production' });
    }

    // `now` override is accepted only outside production (deterministic testing).
    const now = body.now && process.env.NODE_ENV !== 'production' ? new Date(body.now) : new Date();

    const summary = await runAttendanceSweep(prisma, now, { dryRun });

    req.log.info(
      {
        runId: summary.runId,
        durationMs: summary.durationMs,
        dryRun: summary.dryRun,
        totals: summary.totals,
        operations: summary.operations.map((o) => ({ op: o.operation, scanned: o.scanned, processed: o.processed, skipped: o.skipped, failed: o.failed })),
        systemicError: summary.systemicError,
      },
      'attendance sweep run',
    );

    // A systemic failure (an operation threw outright — e.g. DB unreachable) is a
    // non-2xx so the scheduler's retry/alerting kicks in. Individual per-record
    // failures do NOT fail the run (they are reported in the summary).
    if (summary.systemicError) {
      return reply.status(500).send(summary);
    }
    return summary;
  });
}
