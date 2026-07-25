import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { requireAdmin } from './middleware/auth.js';

// POST /geocode/suggest is guarded by `[authenticate, requireAdmin]`. This verifies
// requireAdmin — the exact authorization guard the route attaches — admits
// owners/admins and rejects workers and unauthenticated requests, so address
// autocomplete (and its server-signed tokens) is never available to a worker.
function appWithRole(role?: string) {
  const app = Fastify();
  app.addHook('preHandler', async (req) => {
    (req as any).user = role ? { id: 'u1', role, isActive: true } : undefined;
  });
  app.post('/geocode/suggest', { preHandler: [requireAdmin] }, async () => ({ available: true, candidates: [] }));
  return app;
}

describe('POST /geocode/suggest — owner-only authorization', () => {
  it('allows OWNER', async () => {
    const res = await appWithRole('OWNER').inject({ method: 'POST', url: '/geocode/suggest', payload: { q: 'ישעיהו 22' } });
    expect(res.statusCode).toBe(200);
  });

  it('allows ADMIN', async () => {
    const res = await appWithRole('ADMIN').inject({ method: 'POST', url: '/geocode/suggest', payload: { q: 'ישעיהו 22' } });
    expect(res.statusCode).toBe(200);
  });

  it('forbids WORKER', async () => {
    const res = await appWithRole('WORKER').inject({ method: 'POST', url: '/geocode/suggest', payload: { q: 'ישעיהו 22' } });
    expect(res.statusCode).toBe(403);
  });

  it('forbids an unauthenticated request', async () => {
    const res = await appWithRole(undefined).inject({ method: 'POST', url: '/geocode/suggest', payload: { q: 'ישעיהו 22' } });
    expect(res.statusCode).toBe(403);
  });
});
