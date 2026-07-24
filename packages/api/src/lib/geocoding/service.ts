// Geocoding persistence service (PBI #217, PR-3/PR-5). Turns an address's text
// into the metadata + coordinates we persist on the Address row. It owns the
// create/edit/retry rules and the safety invariants; the routes stay thin.
//
// COORDINATES (PR-5): latitude/longitude are persisted ONLY for a validated
// RESOLVED result. NOT_REQUESTED / NEEDS_REVIEW / FAILED always keep both null.
// The runtime coordinate consumers are gated by `addressMonitoringCoords`
// (@workforce/shared) which additionally requires status === 'RESOLVED', so a
// stray coordinate can never activate monitoring on its own.

import type { GeocodeStatus } from '@workforce/shared';
import { createAzureMapsProvider } from './azureMapsProvider.js';
import { decideGeocode } from './decision.js';
import type { GeocodeProvider, GeocodeQuery } from './types.js';

/**
 * The geocoding fields we may write to an Address. `latitude`/`longitude` are
 * populated ONLY for RESOLVED (null for every other status).
 */
export interface AddressGeoPersistence {
  geocodeStatus: GeocodeStatus;
  latitude: number | null;
  longitude: number | null;
  normalizedAddress: string | null;
  geocodeProvider: string | null;
  geocodeProviderPlaceId: string | null;
  geocodedAt: Date | null;
  geocodeReason: string | null;
}

export interface PreviousAddressGeo {
  fullAddress: string;
  geocodeStatus: GeocodeStatus;
}

/** `apply` = fields to write; `null` = leave the row's geocode fields unchanged. */
export type GeocodeComputation = { apply: AddressGeoPersistence | null };

export interface ComputeAddressGeocodeArgs {
  /** Server-side provider, or null when AZURE_MAPS_KEY is unconfigured. */
  provider: GeocodeProvider | null;
  /** The owner-entered address text to resolve (never mutated). */
  fullAddress: string;
  city?: string | null;
  /** The current stored row on edit/retry; omit/null on create. */
  previous?: PreviousAddressGeo | null;
  /** Owner-initiated retry: geocode even when the text is unchanged. */
  forceLookup?: boolean;
  now?: Date;
}

/** Loose text equality for "did the address change?" — trim + collapse + lowercase. */
function sameAddressText(a: string, b: string): boolean {
  const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

function inactive(status: GeocodeStatus, reason: string, now: Date): AddressGeoPersistence {
  return {
    geocodeStatus: status,
    latitude: null,
    longitude: null,
    normalizedAddress: null,
    geocodeProvider: null,
    geocodeProviderPlaceId: null,
    geocodedAt: now,
    geocodeReason: reason,
  };
}

/**
 * Geocoding runs only when BOTH the runtime kill switch is on AND the server key
 * is configured. Either off → no provider → no lookup → addresses stay
 * NOT_REQUESTED. This lets us deploy the code with geocoding fully disabled and
 * enable it later without a code change; and disable it instantly (operational
 * rollback) without touching the safety gate or any data. Server-only — never
 * exposed to web/mobile.
 */
export function geocodingEnabled(): boolean {
  return process.env.ADDRESS_GEOCODING_ENABLED === 'true' && Boolean(process.env.AZURE_MAPS_KEY);
}

/**
 * Build the Azure Maps–backed provider. Returns null unless geocoding is enabled
 * (flag on + key set), so geocoding is simply skipped rather than failing. The
 * key is read ONLY here and never logged or returned.
 */
export function getConfiguredProvider(): GeocodeProvider | null {
  if (!geocodingEnabled()) return null;
  return createAzureMapsProvider({ apiKey: process.env.AZURE_MAPS_KEY as string });
}

/**
 * Decide the geocode fields to persist for a create/edit/retry. Coordinates are
 * written ONLY for RESOLVED (null for every other status). Safety rules:
 *  - RESOLVED stores validated metadata + coordinates; NEEDS_REVIEW stores
 *    metadata with null coordinates; FAILED stores status + reason only.
 *  - A transient provider failure on an UNCHANGED address (owner retry) preserves
 *    the prior row (never wipes a previously valid geocode or its coordinates).
 *  - Changing the address text invalidates the previous metadata/coordinates
 *    before revalidation (the new result overwrites it).
 *  - Client-supplied coordinates are never consulted — status comes only from the
 *    server's own lookup + decideGeocode.
 */
export async function computeAddressGeocode(args: ComputeAddressGeocodeArgs): Promise<GeocodeComputation> {
  const now = args.now ?? new Date();
  const isCreate = !args.previous;
  const textChanged = isCreate || !sameAddressText(args.previous!.fullAddress, args.fullAddress);

  // Unchanged address and not an explicit retry → do not geocode again.
  if (!isCreate && !textChanged && !args.forceLookup) return { apply: null };

  // No server key configured → cannot validate.
  if (!args.provider) {
    if (isCreate) return { apply: null }; // column default NOT_REQUESTED applies
    // Changed text but cannot geocode → invalidate to an inactive NOT_REQUESTED.
    return { apply: inactive('NOT_REQUESTED', 'PROVIDER_NOT_CONFIGURED', now) };
  }

  const query: GeocodeQuery = { fullAddress: args.fullAddress, city: args.city ?? null, requireHouseLevel: true };
  const response = await args.provider.geocode(query);
  const decision = decideGeocode(query, response);

  if (decision.status === 'RESOLVED') {
    const c = decision.candidate!;
    // Persist validated coordinates ONLY for RESOLVED. Consumers are additionally
    // gated by addressMonitoringCoords (status must be RESOLVED + coords valid).
    return {
      apply: {
        geocodeStatus: 'RESOLVED',
        latitude: c.latitude,
        longitude: c.longitude,
        normalizedAddress: c.formattedAddress || null,
        geocodeProvider: c.provider,
        geocodeProviderPlaceId: c.providerPlaceId,
        geocodedAt: now,
        geocodeReason: decision.reason,
      },
    };
  }

  if (decision.status === 'NEEDS_REVIEW') {
    const c = decision.candidate!;
    // Store the candidate metadata for owner review, but NEVER its coordinates —
    // a non-RESOLVED row must keep latitude/longitude null so it can't activate.
    return {
      apply: {
        geocodeStatus: 'NEEDS_REVIEW',
        latitude: null,
        longitude: null,
        normalizedAddress: c.formattedAddress || null,
        geocodeProvider: c.provider,
        geocodeProviderPlaceId: c.providerPlaceId,
        geocodedAt: now,
        geocodeReason: decision.reason,
      },
    };
  }

  // FAILED: a transient outage on an unchanged address must not wipe a prior
  // valid geocode (preserve prior status, coordinates, and metadata).
  if (decision.transient && !textChanged) return { apply: null };
  // Terminal failure, or a transient failure after the text changed → inactive,
  // with any stale coordinates cleared to null.
  return { apply: inactive('FAILED', decision.reason, now) };
}
