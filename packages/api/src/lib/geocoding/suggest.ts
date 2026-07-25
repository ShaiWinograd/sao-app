// Address-suggestion service (PR-A). Turns the owner's partial query into a small
// set of candidates for display, each carrying a server-signed selection token.
//
// RESPONSE SHAPE: the response has no separate coordinate fields — only a clean
// display, the city, a coarse precision label, an `exact` flag, and the signed
// token. The coordinates live inside that token: base64url-ENCODED (decodable by
// the browser) but HMAC-protected, so they cannot be forged. They are integrity-
// protected, NOT confidential.
//
// PRECISION: a candidate is `exact` (HOUSE) ONLY when Azure returned a point
// address AND the structured components form a complete Israeli address — street
// name, house number, municipality, and countryCode === 'IL'. Anything else is
// labelled approximate and can never become RESOLVED on submit.

import { DEFAULT_THRESHOLDS } from './decision.js';
import { signSelectionToken } from './selectionToken.js';
import type { GeocodeAddressComponents, GeocodeCandidate, GeocodeProvider } from './types.js';

export const MIN_SUGGEST_QUERY_LEN = 3;
export const MAX_SUGGEST_QUERY_LEN = 200;
export const MAX_SUGGESTIONS = 6;
const IL_COUNTRY = 'IL';

export interface SuggestCandidate {
  token: string;
  /** Clean display built from validated structured fields (postal code excluded). */
  displayAddress: string;
  city: string | null;
  /** Coarse precision label for UI (HOUSE | STREET | LOCALITY | REGION | OTHER). */
  precision: string;
  /** True only for a complete Israeli house address — the only kind that can RESOLVE. */
  exact: boolean;
}

export type SuggestResult =
  | { ok: true; candidates: SuggestCandidate[] }
  | { ok: false; code: 'QUERY_TOO_SHORT' | 'NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_ERROR' | 'INVALID_QUERY' };

/**
 * Build a clean Hebrew display from validated structured components. Postal code
 * is deliberately EXCLUDED (kept separate from street/number), preventing malformed
 * output such as `רחוב ישעיהו, 5223392, רמת גן, 22`. Includes the municipality when
 * present; falls back to the coarsest available component otherwise.
 */
export function buildDisplayAddress(c: GeocodeAddressComponents): string {
  const streetLine = [c.streetName, c.streetNumber].filter(Boolean).join(' ').trim();
  const parts = [streetLine, c.municipality].map((p) => (p ?? '').trim()).filter((p) => p.length > 0);
  return parts.join(', ');
}

/** Normalize a country code for case-insensitive comparison. */
function normCountry(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase();
}

/**
 * A complete Israeli house-level address: street name, house number, municipality,
 * and countryCode === 'IL' (case-insensitive). This is the ONLY shape that may
 * become RESOLVED — a result missing the municipality or in another country may be
 * shown as approximate but never resolves.
 */
export function hasCompleteIsraeliHouse(components: GeocodeAddressComponents | null | undefined): boolean {
  return Boolean(
    components &&
      components.streetName &&
      components.streetNumber &&
      components.municipality &&
      normCountry(components.countryCode) === IL_COUNTRY,
  );
}

/** A house-level point that carries a complete Israeli address. */
export function isExactHouse(cand: GeocodeCandidate): boolean {
  return cand.precision === 'HOUSE' && hasCompleteIsraeliHouse(cand.components);
}

/** True when any OTHER candidate is within `ambiguityDelta` of this candidate's confidence. */
function isAmbiguousAgainst(cand: GeocodeCandidate, all: GeocodeCandidate[]): boolean {
  return all.some((other) => other !== cand && Math.abs(other.confidence - cand.confidence) < DEFAULT_THRESHOLDS.ambiguityDelta);
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

  const candidates: SuggestCandidate[] = sorted.map((cand) => {
    const components: GeocodeAddressComponents =
      cand.components ?? { streetName: null, streetNumber: null, municipality: cand.city, postalCode: null, countryCode: null };
    const exact = isExactHouse(cand);
    // Ambiguous when ANY other returned candidate is within ambiguityDelta of THIS
    // candidate's confidence — not merely the top result. Bound so submit
    // revalidation downgrades an ambiguous selection to NEEDS_REVIEW.
    const ambiguous = isAmbiguousAgainst(cand, sorted);
    // The precision we bind for RESOLVED must reflect the complete-Israeli-house
    // check: a "point" that is not a full IL house is only street-accurate.
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
