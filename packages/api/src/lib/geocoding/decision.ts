// Pure geocoding decision logic (PBI #217, PR-2). No I/O, no provider specifics.
// This is the single place that decides whether a lookup is RESOLVED,
// NEEDS_REVIEW, or FAILED. Safety bias: anything short of an unambiguous,
// house-level, in-city, high-confidence result is downgraded so it can never
// (in a later PR) silently activate the §16.4 500 m rule.

import type {
  GeocodeCandidate,
  GeocodeDecision,
  GeocodeDecisionReason,
  GeocodeProviderResponse,
  GeocodeQuery,
} from './types.js';

export interface GeocodeThresholds {
  /** Best confidence must be ≥ this to be RESOLVED. */
  resolvedMinConfidence: number;
  /** If the 2nd-best is within this of the best, the result is AMBIGUOUS. */
  ambiguityDelta: number;
}

export const DEFAULT_THRESHOLDS: GeocodeThresholds = {
  resolvedMinConfidence: 0.8,
  ambiguityDelta: 0.1,
};

/**
 * Normalize a city string for equality: NFKC, strip Hebrew niqqud, drop quotes/
 * punctuation, collapse whitespace, lowercase. Keeps Hebrew letters intact.
 */
export function normalizeCity(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKC')
    .replace(/[\u0591-\u05c7]/g, '')
    .replace(/["'’`.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function fail(reason: GeocodeDecisionReason, transient: boolean): GeocodeDecision {
  return { status: 'FAILED', reason, candidate: null, candidates: [], transient };
}

function review(
  reason: GeocodeDecisionReason,
  best: GeocodeCandidate,
  candidates: GeocodeCandidate[],
): GeocodeDecision {
  return { status: 'NEEDS_REVIEW', reason, candidate: best, candidates, transient: false };
}

/**
 * The single rule set that decides whether ONE best candidate is RESOLVED or
 * downgraded to NEEDS_REVIEW. Shared by `decideGeocode` (which computes
 * `ambiguous` from the full candidate list) and the signed-selection-token path
 * (which carries the server's own `ambiguous` verdict), so both go through the
 * exact same gates. Never returns FAILED — a provider error is handled upstream.
 */
export function classifyCandidate(
  best: GeocodeCandidate,
  ctx: { ambiguous: boolean; expectedCity?: string | null; requireHouseLevel: boolean; thresholds?: GeocodeThresholds },
): { status: 'RESOLVED' | 'NEEDS_REVIEW'; reason: GeocodeDecisionReason } {
  const thresholds = ctx.thresholds ?? DEFAULT_THRESHOLDS;
  // Coarse / centroid results can never be RESOLVED, regardless of the flag.
  if (best.precision === 'LOCALITY' || best.precision === 'REGION') {
    return { status: 'NEEDS_REVIEW', reason: 'CENTROID_RESULT' };
  }
  if (best.precision === 'OTHER') {
    return { status: 'NEEDS_REVIEW', reason: 'NOT_HOUSE_LEVEL' };
  }
  if (ctx.requireHouseLevel && best.precision !== 'HOUSE') {
    return { status: 'NEEDS_REVIEW', reason: 'NOT_HOUSE_LEVEL' };
  }
  // A close-scoring runner-up means the match is ambiguous.
  if (ctx.ambiguous) {
    return { status: 'NEEDS_REVIEW', reason: 'AMBIGUOUS' };
  }
  // City mismatch (only when an expected city was supplied).
  if (ctx.expectedCity && normalizeCity(best.city) !== normalizeCity(ctx.expectedCity)) {
    return { status: 'NEEDS_REVIEW', reason: 'CITY_MISMATCH' };
  }
  // Valid but low-confidence → owner review (distinct from a transient failure).
  if (best.confidence < thresholds.resolvedMinConfidence) {
    return { status: 'NEEDS_REVIEW', reason: 'LOW_CONFIDENCE' };
  }
  return { status: 'RESOLVED', reason: 'RESOLVED_EXACT' };
}

/**
 * Decide the outcome for a query given a provider response. A provider error is
 * mapped to FAILED (with `transient` reflecting retryability); a valid but weak
 * result is NEEDS_REVIEW (never FAILED), so callers can always tell a retryable
 * outage apart from a low-confidence match.
 */
export function decideGeocode(
  query: GeocodeQuery,
  response: GeocodeProviderResponse,
  thresholds: GeocodeThresholds = DEFAULT_THRESHOLDS,
): GeocodeDecision {
  if (!response.ok) {
    switch (response.error.kind) {
      case 'TRANSIENT':
        return fail('PROVIDER_UNAVAILABLE', true);
      case 'CONFIG':
        return fail('CONFIG_ERROR', false);
      case 'INVALID_QUERY':
        return fail('INVALID_QUERY', false);
      case 'PROVIDER':
      default:
        return fail('PROVIDER_ERROR', false);
    }
  }

  const candidates = [...response.candidates].sort((a, b) => b.confidence - a.confidence);
  if (candidates.length === 0) return fail('NO_MATCH', false);

  const best = candidates[0];
  const second = candidates[1];
  const ambiguous = Boolean(second && best.confidence - second.confidence < thresholds.ambiguityDelta);

  const { status, reason } = classifyCandidate(best, {
    ambiguous,
    expectedCity: query.city,
    requireHouseLevel: query.requireHouseLevel !== false, // default true
    thresholds,
  });
  if (status === 'RESOLVED') {
    return { status: 'RESOLVED', reason, candidate: best, candidates, transient: false };
  }
  return review(reason, best, candidates);
}
