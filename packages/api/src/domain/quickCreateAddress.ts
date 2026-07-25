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
import { classifyCandidate } from '../lib/geocoding/decision.js';
import { hasCompleteIsraeliHouse } from '../lib/geocoding/suggest.js';
import { verifySelectionToken } from '../lib/geocoding/selectionToken.js';
import { computeAddressGeocode } from '../lib/geocoding/service.js';
import type { AddressGeoPersistence } from '../lib/geocoding/service.js';
import type { GeocodeCandidate, GeocodeProvider } from '../lib/geocoding/types.js';

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

    // Independently recheck the RESOLVED prerequisites from the STRUCTURED
    // components — never trust a bound `precision: 'HOUSE'` on its own. A complete
    // Israeli house address requires street name, house number, municipality, and
    // countryCode === 'IL'. Anything short of that is downgraded so classify
    // rejects it (no silent RESOLVED for an incomplete/foreign address).
    const qualifies = p.precision === 'HOUSE' && hasCompleteIsraeliHouse(p.components);
    const candidate: GeocodeCandidate = {
      provider: p.provider,
      providerPlaceId: p.providerPlaceId,
      formattedAddress: p.display,
      latitude: p.lat,
      longitude: p.lon,
      precision: qualifies ? 'HOUSE' : p.precision === 'HOUSE' ? 'STREET' : p.precision,
      city: p.city,
      confidence: p.confidence,
      components: p.components,
    };

    // Revalidate through the EXACT same rules used for a server-initiated geocode.
    // The municipality is enforced above via hasCompleteIsraeliHouse; pass it as
    // the expected city so a component/city inconsistency is also caught.
    const { status, reason } = classifyCandidate(candidate, {
      ambiguous: p.ambiguous,
      expectedCity: p.components?.municipality ?? null,
      requireHouseLevel: true,
    });

    if (status !== 'RESOLVED') {
      // Do NOT silently create a NEEDS_REVIEW job — surface the failure so the owner
      // can search/select again or deliberately use the manual fallback.
      throw new AppError(422, 'ADDRESS_NOT_RESOLVABLE', 'לא ניתן לאמת את הכתובת שנבחרה כמדויקת.', {
        reason,
        displayAddress: p.display,
        precision: candidate.precision,
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
        geocodeReason: reason,
      },
    };
  }

  // ── Legacy free-text: unchanged server-side geocode of the owner's text. ──
  const fullAddress = args.cityOrAddress!.trim();
  const geo = await computeAddressGeocode({ provider: deps.provider, fullAddress }).catch(() => ({ apply: null }));
  return { fullAddress, apply: geo.apply };
}
