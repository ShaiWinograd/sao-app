import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { requireAdmin } from './middleware/auth.js';

// POST /jobs/:id/assign-customer is guarded by `[authenticate, requireAdmin]`.
// This verifies requireAdmin — the exact authorization guard the route attaches —
// admits owners/admins and rejects workers and unauthenticated requests, so a
// General-Reservation job can never be re-assigned to a customer by a non-owner.
function appWithRole(role?: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    (req as any).user = role ? { role, isActive: true } : undefined;
  });
  app.post('/jobs/:id/assign-customer', { preHandler: [requireAdmin] }, async () => ({ ok: true }));
  return app;
}

describe('POST /jobs/:id/assign-customer — owner-only authorization', () => {
  it('allows OWNER', async () => {
    const res = await appWithRole('OWNER').inject({ method: 'POST', url: '/jobs/j1/assign-customer', payload: { customerId: 'c1' } });
    expect(res.statusCode).toBe(200);
  });

  it('allows ADMIN', async () => {
    const res = await appWithRole('ADMIN').inject({ method: 'POST', url: '/jobs/j1/assign-customer', payload: { customerId: 'c1' } });
    expect(res.statusCode).toBe(200);
  });

  it('forbids WORKER', async () => {
    const res = await appWithRole('WORKER').inject({ method: 'POST', url: '/jobs/j1/assign-customer', payload: { customerId: 'c1' } });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an unauthenticated request', async () => {
    const res = await appWithRole(undefined).inject({ method: 'POST', url: '/jobs/j1/assign-customer', payload: { customerId: 'c1' } });
    expect(res.statusCode).toBe(403);
  });
});
