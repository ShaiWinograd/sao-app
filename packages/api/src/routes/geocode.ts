import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { getConfiguredProvider } from '../lib/geocoding/service.js';
import { getSelectionSecret } from '../lib/geocoding/selectionToken.js';
import { buildSuggestions, MAX_SUGGEST_QUERY_LEN, MIN_SUGGEST_QUERY_LEN } from '../lib/geocoding/suggest.js';
import { createRateLimiter } from '../lib/geocoding/rateLimiter.js';

// Per-process abuse smoothing for the (chatty) typeahead endpoint. Keyed by user.
const suggestLimiter = createRateLimiter({ limit: 40, windowMs: 10_000 });

// The query is sent in the POST body (not the URL) so full addresses never land
// in access logs. Bounded length to cap provider cost and abuse.
const SuggestBody = z.object({ q: z.string().max(MAX_SUGGEST_QUERY_LEN * 2) });

export async function geocodeRoutes(app: FastifyInstance) {
  // Owner/admin-only address autocomplete. The Azure key stays server-side; the
  // response carries NO coordinates or provider secrets — only a clean display,
  // city, coarse precision, an `exact` flag, and an opaque signed selection token.
  app.post('/suggest', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { q } = SuggestBody.parse(req.body);

    const userId = (req as any).user?.id ?? 'anonymous';
    if (!suggestLimiter.take(userId)) {
      return reply.status(429).send({ error: 'RATE_LIMITED', message: 'יותר מדי בקשות חיפוש. נסי שוב בעוד רגע.' });
    }

    // Search + selection require BOTH the provider (Azure key + flag) and the
    // signing secret. When either is missing, the UI degrades to manual entry.
    const provider = getConfiguredProvider();
    const secret = getSelectionSecret();
    if (!provider || !secret) {
      return reply.status(200).send({ available: false, candidates: [] });
    }

    const trimmed = q.trim();
    if (trimmed.length < MIN_SUGGEST_QUERY_LEN) {
      return reply.status(200).send({ available: true, candidates: [], reason: 'QUERY_TOO_SHORT' });
    }

    const result = await buildSuggestions({ provider, secret, query: trimmed });
    if (!result.ok) {
      if (result.code === 'QUERY_TOO_SHORT') {
        return reply.status(200).send({ available: true, candidates: [], reason: 'QUERY_TOO_SHORT' });
      }
      if (result.code === 'PROVIDER_UNAVAILABLE') {
        return reply.status(503).send({ error: 'PROVIDER_UNAVAILABLE', message: 'שירות חיפוש הכתובות אינו זמין כרגע.', retryable: true });
      }
      // INVALID_QUERY / PROVIDER_ERROR / NOT_CONFIGURED → no usable suggestions.
      return reply.status(200).send({ available: true, candidates: [] });
    }

    return reply.status(200).send({ available: true, candidates: result.candidates });
  });
}
