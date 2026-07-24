// Server-side geocoding — provider-neutral model (PBI #217, PR-2).
//
// This module is DORMANT: it defines the boundary and the decision logic but is
// not wired into any create/edit, owner UI, or geofence path yet. The safety
// contract lives in `decision.ts`; only a `RESOLVED` decision may (in a later
// PR) activate the §16.4 500 m attendance rule.

import type { GeocodeStatus } from '@workforce/shared';

/** Provider-neutral precision of a geocoding result. */
export type ResultPrecision = 'HOUSE' | 'STREET' | 'LOCALITY' | 'REGION' | 'OTHER';

/**
 * The owner-entered address to resolve, plus expectations used to gate the
 * result. `fullAddress` is the original owner snapshot and is never mutated.
 */
export interface GeocodeQuery {
  fullAddress: string;
  /** Expected city, when known — used for the city-match check. */
  city?: string | null;
  /** Default true: the 500 m rule needs a house-level point to be RESOLVED. */
  requireHouseLevel?: boolean;
}

/** A single normalized candidate returned by any provider adapter. */
export interface GeocodeCandidate {
  provider: string;
  providerPlaceId: string | null;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  precision: ResultPrecision;
  city: string | null;
  /** Calibrated 0..1 confidence. Adapters normalize the provider score into this range. */
  confidence: number;
}

/**
 * Provider error taxonomy. `TRANSIENT` is retryable (network/timeout/429/5xx) and
 * MUST stay distinguishable from a valid-but-weak result; the rest are terminal.
 */
export type GeocodeErrorKind = 'TRANSIENT' | 'PROVIDER' | 'CONFIG' | 'INVALID_QUERY';

export interface GeocodeError {
  kind: GeocodeErrorKind;
  message: string;
}

/** Discriminated provider response — adapters never throw for an expected error. */
export type GeocodeProviderResponse =
  | { ok: true; candidates: GeocodeCandidate[] }
  | { ok: false; error: GeocodeError };

/** The pluggable provider boundary. Azure Maps is the first adapter. */
export interface GeocodeProvider {
  readonly name: string;
  geocode(query: GeocodeQuery): Promise<GeocodeProviderResponse>;
}

/** Reason attached to a decision (owner-facing wording is mapped elsewhere). */
export type GeocodeDecisionReason =
  | 'RESOLVED_EXACT'
  | 'NO_MATCH'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_ERROR'
  | 'CONFIG_ERROR'
  | 'INVALID_QUERY'
  | 'NOT_HOUSE_LEVEL'
  | 'CENTROID_RESULT'
  | 'AMBIGUOUS'
  | 'LOW_CONFIDENCE'
  | 'CITY_MISMATCH';

/** Decision status is the subset of GeocodeStatus a lookup can produce. */
export type GeocodeDecisionStatus = Exclude<GeocodeStatus, 'NOT_REQUESTED'>;

export interface GeocodeDecision {
  status: GeocodeDecisionStatus;
  reason: GeocodeDecisionReason;
  /** Chosen candidate for RESOLVED; best/ambiguous for NEEDS_REVIEW; null for FAILED. */
  candidate: GeocodeCandidate | null;
  /** All considered candidates (for owner selection in a later PR). */
  candidates: GeocodeCandidate[];
  /** Only meaningful for FAILED: whether a retry might succeed. */
  transient: boolean;
}
