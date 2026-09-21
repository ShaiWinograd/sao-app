// Quick Create address resolution (PR-A). Turns the owner's address intent — a
// legacy free-text `cityOrAddress`, a signed `selected` suggestion, or an explicit
// `manual` fallback — into the geocode fields to persist on the new Address, or
// throws a structured AppError that leaves the caller free to abort BEFORE any DB
// write. It performs NO database I/O and NO network call in the selected/manual
// paths: `selected` is validated purely from the server-signed token.
//
// Contracts (additive / backward-compatible):
//   - legacy  : { cityOrAddress }            → unchanged server-side geocode of the text
//   - selected: { mode:'selected', token }   → verify + revalidate the signed candidate
//   - manual  : { mode:'manual', text, confirmedUnresolved:true } → NEEDS_REVIEW, no coords
//
// Safety invariants:
//   - Coordinates are persisted ONLY for a RESOLVED selection.
//   - A selection that fails the RESOLVED rules is NEVER silently downgraded to a
//     NEEDS_REVIEW job — the caller must surface the failure and let the owner
//     choose (search again / deliberate manual fallback).
//   - Only `manual` + confirmedUnresolved may intentionally create NEEDS_REVIEW.
//   - Client coordinates are never trusted; the token's coordinates are the
//     server's own (HMAC-vouched).

import type { GeocodeStatus } from '@workforce/shared';
import { AppError } from '../lib/errors.js';
import { hasCompleteIsraeliHouse } from '../lib/geocoding/suggest.js';
import { verifySelectionToken } from '../lib/geocoding/selectionToken.js';
import { computeAddressGeocode } from '../lib/geocoding/service.js';
import type { AddressGeoPersistence } from '../lib/geocoding/service.js';
import type { GeocodeProvider } from '../lib/geocoding/types.js';

export type SelectedAddressInput = { mode: 'selected'; token: string };
export type ManualAddressInput = { mode: 'manual'; text: string; confirmedUnresolved: true };
export type AddressInput = SelectedAddressInput | ManualAddressInput;

export interface QuickCreateAddressArgs {
  /** New contract; when present, `cityOrAddress` must be absent. */
  address?: AddressInput;
  /** Legacy contract; unchanged behavior. */
  cityOrAddress?: string;
}

export interface QuickCreateAddressDeps {
  /** Server geocoding provider (legacy path), or null when unconfigured. */
  provider: GeocodeProvider | null;
  /** Selection-token signing secret, or null when unconfigured. */
  secret: string | null;
  now?: Date;
}

export interface ResolvedQuickAddress {
  /** Text stored on Address.fullAddress (owner-selected display / typed text / legacy text). */
  fullAddress: string;
  /** Geocode fields to merge into the Address row; null = leave defaults (NOT_REQUESTED). */
  apply: AddressGeoPersistence | null;
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
 * Resolve the address fields for Quick Create. Throws AppError for a selection
 * that cannot become a validated job so the route aborts before any write.
 */
export async function resolveQuickCreateAddress(
  args: QuickCreateAddressArgs,
  deps: QuickCreateAddressDeps,
): Promise<ResolvedQuickAddress> {
  const now = deps.now ?? new Date();

  // Exactly one contract must be supplied.
  const hasNew = args.address != null;
  const hasLegacy = typeof args.cityOrAddress === 'string' && args.cityOrAddress.trim().length > 0;
  if (hasNew === hasLegacy) {
    throw new AppError(400, 'ADDRESS_REQUIRED', 'יש לספק כתובת (בחירה, ידנית, או טקסט חופשי).');
  }

  // ── Manual fallback: only an explicit confirmation may create NEEDS_REVIEW. ──
  if (args.address?.mode === 'manual') {
    const text = args.address.text.trim();
    if (!text) throw new AppError(400, 'ADDRESS_REQUIRED', 'יש להזין כתובת.');
    if (args.address.confirmedUnresolved !== true) {
      throw new AppError(400, 'MANUAL_CONFIRMATION_REQUIRED', 'יש לאשר יצירת כתובת ללא אימות מיקום.');
    }
    return { fullAddress: text, apply: inactive('NEEDS_REVIEW', 'MANUAL_UNRESOLVED', now) };
  }

  // ── Selected suggestion: verify the signed token, then revalidate the rules. ──
  if (args.address?.mode === 'selected') {
    if (!deps.secret) {
      throw new AppError(503, 'GEOCODE_NOT_CONFIGURED', 'חיפוש הכתובות אינו זמין כרגע. נסי שוב מאוחר יותר.', { retryable: true });
    }
    const verified = verifySelectionToken(args.address.token, deps.secret, now);
    if (!verified.ok) {
      if (verified.reason === 'EXPIRED') {
        throw new AppError(409, 'ADDRESS_SELECTION_EXPIRED', 'בחירת הכתובת פגה. חפשי ובחרי כתובת מחדש.');
      }
      throw new AppError(400, 'ADDRESS_SELECTION_INVALID', 'בחירת הכתובת אינה תקינה. חפשי ובחרי כתובת מחדש.');
    }
    const p = verified.payload;

    // The owner explicitly chose this server-provided result. A signed selection
    // with city, street, house number, and valid coordinates is verified
    // automatically; ranking ambiguity and provider confidence only matter before
    // the owner chooses. The HMAC keeps all persisted coordinates server-owned.
    const hasValidCoordinates =
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      p.lat >= -90 &&
      p.lat <= 90 &&
      p.lon >= -180 &&
      p.lon <= 180;
    const qualifies =
      p.precision === 'HOUSE' &&
      hasCompleteIsraeliHouse(p.components) &&
      hasValidCoordinates;

    if (!qualifies) {
      throw new AppError(422, 'ADDRESS_NOT_RESOLVABLE', 'לא ניתן לאמת את הכתובת שנבחרה כמדויקת.', {
        displayAddress: p.display,
        precision: p.precision,
      });
    }

    return {
      fullAddress: p.display,
      apply: {
        geocodeStatus: 'RESOLVED',
        latitude: p.lat,
        longitude: p.lon,
        normalizedAddress: p.display,
        geocodeProvider: p.provider,
        geocodeProviderPlaceId: p.providerPlaceId,
        geocodedAt: now,
        geocodeReason: 'RESOLVED_EXACT',
      },
    };
  }

  // ── Legacy free-text: unchanged server-side geocode of the owner's text. ──
  const fullAddress = args.cityOrAddress!.trim();
  const geo = await computeAddressGeocode({ provider: deps.provider, fullAddress }).catch(() => ({ apply: null }));
  return { fullAddress, apply: geo.apply };
}
