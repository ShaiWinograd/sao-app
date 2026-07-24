import { describe, expect, it } from 'vitest';
import { CreateAddressSchema } from '@workforce/shared';
import { computeAddressGeocode } from './service.js';
import type { GeocodeCandidate, GeocodeProvider, GeocodeProviderResponse } from './types.js';

function candidate(over: Partial<GeocodeCandidate> = {}): GeocodeCandidate {
  return {
    provider: 'azure-maps',
    providerPlaceId: 'place-1',
    formattedAddress: 'הרצל 10, תל אביב',
    latitude: 32.06,
    longitude: 34.77,
    precision: 'HOUSE',
    city: 'תל אביב',
    confidence: 0.95,
    ...over,
  };
}

function provider(response: GeocodeProviderResponse): GeocodeProvider {
  return { name: 'fake', geocode: async () => response };
}
const ok = (candidates: GeocodeCandidate[]): GeocodeProviderResponse => ({ ok: true, candidates });
const transient: GeocodeProviderResponse = { ok: false, error: { kind: 'TRANSIENT', message: 'down' } };

const PERSIST_KEYS = [
  'geocodeStatus',
  'geocodedAt',
  'geocodeProvider',
  'geocodeProviderPlaceId',
  'geocodeReason',
  'normalizedAddress',
].sort();

describe('computeAddressGeocode — PR-3 persistence (no coordinates written)', () => {
  it('resolved create: persists RESOLVED + validated metadata, but NEVER latitude/longitude', async () => {
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate()])),
      fullAddress: 'הרצל 10, תל אביב',
      city: 'תל אביב',
    });
    expect(r.apply).not.toBeNull();
    expect(r.apply!.geocodeStatus).toBe('RESOLVED');
    expect(r.apply!.normalizedAddress).toBe('הרצל 10, תל אביב');
    expect(r.apply!.geocodeProvider).toBe('azure-maps');
    expect(r.apply!.geocodeProviderPlaceId).toBe('place-1');
    expect(r.apply!.geocodedAt).toBeInstanceOf(Date);
    // Acceptance: coordinates are deferred to PR-5 — the shape has no lat/lon.
    expect(Object.keys(r.apply!)).not.toContain('latitude');
    expect(Object.keys(r.apply!)).not.toContain('longitude');
    expect(Object.keys(r.apply!).sort()).toEqual(PERSIST_KEYS);
  });

  it('ambiguous result → NEEDS_REVIEW (inactive), metadata stored, no coordinates', async () => {
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate({ confidence: 0.9, providerPlaceId: 'a' }), candidate({ confidence: 0.85, providerPlaceId: 'b' })])),
      fullAddress: 'הרצל, תל אביב',
      city: 'תל אביב',
    });
    expect(r.apply!.geocodeStatus).toBe('NEEDS_REVIEW');
    expect(r.apply!.geocodeReason).toBe('AMBIGUOUS');
    expect(Object.keys(r.apply!).sort()).toEqual(PERSIST_KEYS);
  });

  it('different city → NEEDS_REVIEW', async () => {
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate({ city: 'חיפה' })])),
      fullAddress: 'הרצל 10, תל אביב',
      city: 'תל אביב',
    });
    expect(r.apply!.geocodeStatus).toBe('NEEDS_REVIEW');
    expect(r.apply!.geocodeReason).toBe('CITY_MISMATCH');
  });

  it('transient provider failure on create → FAILED, inactive, no metadata/coordinates', async () => {
    const r = await computeAddressGeocode({ provider: provider(transient), fullAddress: 'הרצל 10, תל אביב' });
    expect(r.apply!.geocodeStatus).toBe('FAILED');
    expect(r.apply!.geocodeReason).toBe('PROVIDER_UNAVAILABLE');
    expect(r.apply!.normalizedAddress).toBeNull();
    expect(r.apply!.geocodeProviderPlaceId).toBeNull();
  });

  it('changed address text invalidates previous metadata before revalidation', async () => {
    // Previously RESOLVED; the new (changed) text resolves elsewhere → overwrite.
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate({ formattedAddress: 'ויצמן 5, חיפה', city: 'חיפה', providerPlaceId: 'new' })])),
      fullAddress: 'ויצמן 5, חיפה',
      city: 'חיפה',
      previous: { fullAddress: 'הרצל 10, תל אביב', geocodeStatus: 'RESOLVED' },
    });
    expect(r.apply!.geocodeStatus).toBe('RESOLVED');
    expect(r.apply!.geocodeProviderPlaceId).toBe('new'); // old metadata replaced
    // And when the changed text fails, the old metadata is cleared (not retained).
    const failed = await computeAddressGeocode({
      provider: provider(transient),
      fullAddress: 'שדרה חדשה 1, אילת',
      previous: { fullAddress: 'הרצל 10, תל אביב', geocodeStatus: 'RESOLVED' },
    });
    expect(failed.apply!.geocodeStatus).toBe('FAILED');
    expect(failed.apply!.normalizedAddress).toBeNull();
    expect(failed.apply!.geocodeProviderPlaceId).toBeNull();
  });

  it('same address + transient failure (owner retry) preserves the prior row', async () => {
    const r = await computeAddressGeocode({
      provider: provider(transient),
      fullAddress: 'הרצל 10, תל אביב',
      previous: { fullAddress: 'הרצל 10, תל אביב', geocodeStatus: 'RESOLVED' },
      forceLookup: true,
    });
    expect(r.apply).toBeNull(); // leave the previously valid geocode untouched
  });

  it('client-supplied coordinates cannot force RESOLVED', async () => {
    // The input schema strips any client coordinates, so they never persist...
    const parsed = CreateAddressSchema.parse({
      customerId: 'c1',
      fullAddress: 'הרצל 10, תל אביב',
      label: 'OTHER',
      latitude: 32.06,
      longitude: 34.77,
    } as any);
    expect(parsed).not.toHaveProperty('latitude');
    expect(parsed).not.toHaveProperty('longitude');
    // ...and the status is derived only from the server lookup: a weak result
    // stays NEEDS_REVIEW even though the caller "supplied" perfect coordinates.
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate({ precision: 'STREET' })])),
      fullAddress: 'הרצל 10, תל אביב',
      city: 'תל אביב',
    });
    expect(r.apply!.geocodeStatus).toBe('NEEDS_REVIEW');
  });

  it('existing NOT_REQUESTED (unchanged address, no retry) stays untouched — no lookup', async () => {
    let called = false;
    const spyProvider: GeocodeProvider = {
      name: 'spy',
      geocode: async () => {
        called = true;
        return ok([candidate()]);
      },
    };
    const r = await computeAddressGeocode({
      provider: spyProvider,
      fullAddress: 'תל אביב',
      previous: { fullAddress: 'תל אביב', geocodeStatus: 'NOT_REQUESTED' },
    });
    expect(r.apply).toBeNull();
    expect(called).toBe(false); // unchanged address is never re-geocoded
  });

  it('no raw provider payload is ever persisted', async () => {
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate()])),
      fullAddress: 'הרצל 10, תל אביב',
      city: 'תל אביב',
    });
    const serialized = JSON.stringify(r.apply);
    expect(serialized).not.toMatch(/candidates|matchConfidence|position|freeformAddress|results/i);
    // geocodeReason is a short code, not a serialized payload.
    expect(r.apply!.geocodeReason).toBe('RESOLVED_EXACT');
    expect(r.apply!.geocodeReason).not.toMatch(/[{}[\]]/);
  });

  it('no provider configured: create leaves defaults; changed-text edit invalidates to NOT_REQUESTED', async () => {
    const create = await computeAddressGeocode({ provider: null, fullAddress: 'הרצל 10, תל אביב' });
    expect(create.apply).toBeNull(); // column default NOT_REQUESTED applies

    const edit = await computeAddressGeocode({
      provider: null,
      fullAddress: 'חדש 1, אילת',
      previous: { fullAddress: 'הרצל 10, תל אביב', geocodeStatus: 'RESOLVED' },
    });
    expect(edit.apply!.geocodeStatus).toBe('NOT_REQUESTED');
    expect(edit.apply!.geocodeReason).toBe('PROVIDER_NOT_CONFIGURED');
  });
});
