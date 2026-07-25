// Address-suggestion service (PR-A). Turns the owner's partial query into a small
// set of candidates for display, each carrying a server-signed selection token.
//
// SAFETY: the response NEVER contains coordinates or provider secrets — only a
// clean display, the city, a coarse precision label, an `exact` flag, and the
// opaque token. Coordinates live only inside the signed token (server-vouched).
//
// PRECISION: a candidate is `exact` (HOUSE) ONLY when Azure returned a point
// address AND the structured components include a street name and a house number.
// Anything else is labelled approximate and can never become RESOLVED on submit.

import { DEFAULT_THRESHOLDS } from './decision.js';
import { signSelectionToken } from './selectionToken.js';
import type { GeocodeAddressComponents, GeocodeCandidate, GeocodeProvider } from './types.js';

export const MIN_SUGGEST_QUERY_LEN = 3;
export const MAX_SUGGEST_QUERY_LEN = 200;
export const MAX_SUGGESTIONS = 6;

export interface SuggestCandidate {
  token: string;
  /** Clean display built from validated structured fields (postal code excluded). */
  displayAddress: string;
  city: string | null;
  /** Coarse precision label for UI (HOUSE | STREET | LOCALITY | REGION | OTHER). */
  precision: string;
  /** True only for a house-level point with street + number — the only kind that can RESOLVE. */
  exact: boolean;
}

export type SuggestResult =
  | { ok: true; candidates: SuggestCandidate[] }
  | { ok: false; code: 'QUERY_TOO_SHORT' | 'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_ERROR' | 'INVALID_QUERY' };

/**
 * Build a clean Hebrew display from validated structured components. Postal code
 * is deliberately EXCLUDED (kept separate from street/number), preventing malformed
 * output such as `רחוב ישעיהו, 5223392, רמת גן, 22`. Falls back to the coarsest
 * available component so an approximate result still shows something meaningful.
 */
export function buildDisplayAddress(c: GeocodeAddressComponents): string {
  const streetLine = [c.streetName, c.streetNumber].filter(Boolean).join(' ').trim();
  const parts = [streetLine, c.municipality].map((p) => (p ?? '').trim()).filter((p) => p.length > 0);
  return parts.join(', ');
}

/** A house-level point that actually carries a street name AND a house number. */
export function isExactHouse(cand: GeocodeCandidate): boolean {
  return (
    cand.precision === 'HOUSE' &&
    Boolean(cand.components?.streetName && cand.components?.streetNumber)
  );
}

/**
 * Produce display-safe suggestions with signed tokens. `secret` must be present
 * (the caller checks configuration first). No coordinates are returned.
 */
export async function buildSuggestions(args: {
  provider: GeocodeProvider;
  secret: string;
  query: string;
  now?: Date;
}): Promise<SuggestResult> {
  const q = args.query.trim();
  if (q.length < MIN_SUGGEST_QUERY_LEN) return { ok: false, code: 'QUERY_TOO_SHORT' };

  const response = await args.provider.geocode({
    fullAddress: q.slice(0, MAX_SUGGEST_QUERY_LEN),
    typeahead: true,
    limit: MAX_SUGGESTIONS,
    requireHouseLevel: false,
  });
  if (!response.ok) {
    switch (response.error.kind) {
      case 'TRANSIENT':
        return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
      case 'INVALID_QUERY':
        return { ok: false, code: 'INVALID_QUERY' };
      case 'CONFIG':
        return { ok: false, code: 'NOT_CONFIGURED' };
      default:
        return { ok: false, code: 'PROVIDER_ERROR' };
    }
  }

  const sorted = [...response.candidates].sort((a, b) => b.confidence - a.confidence).slice(0, MAX_SUGGESTIONS);

  const candidates: SuggestCandidate[] = sorted.map((cand, i) => {
    const components: GeocodeAddressComponents =
      cand.components ?? { streetName: null, streetNumber: null, municipality: cand.city, postalCode: null, countryCode: null };
    const exact = isExactHouse(cand);
    // An exact candidate that has a close-scoring neighbour is ambiguous — bind
    // that verdict so submit revalidation downgrades it to NEEDS_REVIEW.
    const neighbour = sorted[i === 0 ? 1 : 0];
    const ambiguous = Boolean(neighbour && neighbour !== cand && Math.abs(neighbour.confidence - cand.confidence) < DEFAULT_THRESHOLDS.ambiguityDelta);
    // The precision we bind for RESOLVED must reflect the street+number check:
    // a "point" without a house number is only street-accurate.
    const precision = exact ? 'HOUSE' : cand.precision === 'HOUSE' ? 'STREET' : cand.precision;
    const display = buildDisplayAddress(components) || cand.city || cand.formattedAddress;

    const token = signSelectionToken(
      {
        provider: cand.provider,
        providerPlaceId: cand.providerPlaceId,
        lat: cand.latitude,
        lon: cand.longitude,
        precision,
        confidence: cand.confidence,
        city: cand.city,
        components,
        display,
        ambiguous,
        query: q,
      },
      args.secret,
      { now: args.now },
    );

    return { token, displayAddress: display, city: cand.city, precision, exact };
  });

  return { ok: true, candidates };
}
