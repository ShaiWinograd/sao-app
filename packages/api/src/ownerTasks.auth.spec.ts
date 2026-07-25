import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { requireAdmin } from './middleware/auth.js';

// The GET /admin/tasks route is guarded by `[authenticate, requireAdmin]`. This
// verifies that requireAdmin — the exact authorization guard the route attaches —
// admits owners/admins and rejects workers and unauthenticated requests, so the
// Requires-Attention data is never exposed to non-owners. No DB or Clerk needed.

function appWithRole(role?: string) {
  const app = Fastify();
  // Stand in for `authenticate`, which populates req.user upstream.
  app.addHook('preHandler', async (req) => {
    (req as any).user = role ? { role, isActive: true } : undefined;
  });
  app.get('/admin/tasks', { preHandler: [requireAdmin] }, async () => ({ ok: true }));
  return app;
}

describe('GET /admin/tasks — owner-only authorization', () => {
  it('allows OWNER', async () => {
    const res = await appWithRole('OWNER').inject({ method: 'GET', url: '/admin/tasks' });
    expect(res.statusCode).toBe(200);
  });

  it('allows ADMIN', async () => {
    const res = await appWithRole('ADMIN').inject({ method: 'GET', url: '/admin/tasks' });
    expect(res.statusCode).toBe(200);
  });

  it('forbids WORKER', async () => {
    const res = await appWithRole('WORKER').inject({ method: 'GET', url: '/admin/tasks' });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an unauthenticated request', async () => {
    const res = await appWithRole(undefined).inject({ method: 'GET', url: '/admin/tasks' });
    expect(res.statusCode).toBe(403);
  });
});
