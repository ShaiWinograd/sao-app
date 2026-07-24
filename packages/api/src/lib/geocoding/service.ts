// Geocoding persistence service (PBI #217, PR-3). Turns an address's text into
// the metadata we persist on the Address row. It owns the create/edit/retry
// rules and the safety invariants; the routes stay thin.
//
// ─────────────────────────────────────────────────────────────────────────────
// TODO(PR-5): Validated coordinates are intentionally deferred until the RESOLVED
// consumer gate is deployed. Attendance (§16.1) and the mobile leaving-area
// watcher (§16.4) read Address.latitude/longitude DIRECTLY, so writing coordinates
// here would activate the 500 m rule and the watcher before an explicit
// `geocodeStatus === 'RESOLVED' && lat/lon present` gate exists. PR-3 therefore
// NEVER writes latitude/longitude (they stay NULL for every status, RESOLVED
// included). PR-5 lands atomically: (1) gate the attendance API consumers, (2)
// gate the mobile watcher payload/consumer, (3) only then persist RESOLVED
// coordinates, (4) keep non-RESOLVED coordinates null, (5) add integration tests.
// The provider's coordinates exist only in memory during this request.
// ─────────────────────────────────────────────────────────────────────────────

import type { GeocodeStatus } from '@workforce/shared';
import { createAzureMapsProvider } from './azureMapsProvider.js';
import { decideGeocode } from './decision.js';
import type { GeocodeProvider, GeocodeQuery } from './types.js';

/**
 * The geocoding fields PR-3 may write to an Address. NOTE: `latitude` and
 * `longitude` are deliberately absent — see the TODO(PR-5) above.
 */
export interface AddressGeoPersistence {
  geocodeStatus: GeocodeStatus;
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
    normalizedAddress: null,
    geocodeProvider: null,
    geocodeProviderPlaceId: null,
    geocodedAt: now,
    geocodeReason: reason,
  };
}

/**
 * Build the Azure Maps–backed provider from the server-only `AZURE_MAPS_KEY`.
 * Returns null when the key is unset, so geocoding is simply skipped (addresses
 * stay NOT_REQUESTED) rather than failing. The key is read ONLY here and never
 * logged or returned.
 */
export function getConfiguredProvider(): GeocodeProvider | null {
  const apiKey = process.env.AZURE_MAPS_KEY;
  if (!apiKey) return null;
  return createAzureMapsProvider({ apiKey });
}

/**
 * Decide the geocode fields to persist for a create/edit/retry. Coordinates are
 * intentionally never written in PR-3 (see TODO(PR-5)). Safety rules:
 *  - RESOLVED / NEEDS_REVIEW store the validated metadata + status + reason.
 *  - FAILED stores the failure status + reason with no metadata.
 *  - A transient provider failure on an UNCHANGED address (owner retry) preserves
 *    the prior row (never wipes a previously valid geocode).
 *  - Changing the address text invalidates the previous metadata before
 *    revalidation (the new result overwrites it).
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

  if (decision.status === 'RESOLVED' || decision.status === 'NEEDS_REVIEW') {
    const c = decision.candidate!;
    return {
      apply: {
        geocodeStatus: decision.status,
        normalizedAddress: c.formattedAddress || null,
        geocodeProvider: c.provider,
        geocodeProviderPlaceId: c.providerPlaceId,
        geocodedAt: now,
        geocodeReason: decision.reason,
      },
    };
  }

  // FAILED: a transient outage on an unchanged address must not wipe a prior
  // valid geocode.
  if (decision.transient && !textChanged) return { apply: null };
  return { apply: inactive('FAILED', decision.reason, now) };
}
