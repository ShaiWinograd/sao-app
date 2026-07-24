import { describe, expect, it, afterEach, vi } from 'vitest';
import { CreateAddressSchema } from '@workforce/shared';
import { computeAddressGeocode, geocodingEnabled, getConfiguredProvider } from './service.js';
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
  'latitude',
  'longitude',
  'normalizedAddress',
].sort();

describe('computeAddressGeocode — PR-5 persistence (RESOLVED coordinates only)', () => {
  it('resolved create: persists RESOLVED + validated metadata AND coordinates', async () => {
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate()])),
      fullAddress: 'הרצל 10, תל אביב',
      city: 'תל אביב',
    });
    expect(r.apply).not.toBeNull();
    expect(r.apply!.geocodeStatus).toBe('RESOLVED');
    expect(r.apply!.latitude).toBe(32.06);
    expect(r.apply!.longitude).toBe(34.77);
    expect(r.apply!.normalizedAddress).toBe('הרצל 10, תל אביב');
    expect(r.apply!.geocodeProvider).toBe('azure-maps');
    expect(r.apply!.geocodeProviderPlaceId).toBe('place-1');
    expect(r.apply!.geocodedAt).toBeInstanceOf(Date);
    expect(Object.keys(r.apply!).sort()).toEqual(PERSIST_KEYS);
  });

  it('resolved create at 0/0 persists the zero coordinates (not dropped as falsy)', async () => {
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate({ latitude: 0, longitude: 0 })])),
      fullAddress: 'קו המשווה',
    });
    expect(r.apply!.geocodeStatus).toBe('RESOLVED');
    expect(r.apply!.latitude).toBe(0);
    expect(r.apply!.longitude).toBe(0);
  });

  it('ambiguous result → NEEDS_REVIEW (inactive): metadata stored, coordinates NULL', async () => {
    const r = await computeAddressGeocode({
      provider: provider(ok([candidate({ confidence: 0.9, providerPlaceId: 'a' }), candidate({ confidence: 0.85, providerPlaceId: 'b' })])),
      fullAddress: 'הרצל, תל אביב',
      city: 'תל אביב',
    });
    expect(r.apply!.geocodeStatus).toBe('NEEDS_REVIEW');
    expect(r.apply!.geocodeReason).toBe('AMBIGUOUS');
    expect(r.apply!.latitude).toBeNull();
    expect(r.apply!.longitude).toBeNull();
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
    // Stale coordinates are cleared on a changed-address failure.
    expect(failed.apply!.latitude).toBeNull();
    expect(failed.apply!.longitude).toBeNull();
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

describe('geocodingEnabled / getConfiguredProvider (feature flag + key)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is disabled unless BOTH the flag is on AND the key is set', () => {
    vi.stubEnv('ADDRESS_GEOCODING_ENABLED', 'false');
    vi.stubEnv('AZURE_MAPS_KEY', 'k');
    expect(geocodingEnabled()).toBe(false);
    expect(getConfiguredProvider()).toBeNull();

    vi.stubEnv('ADDRESS_GEOCODING_ENABLED', 'true');
    vi.stubEnv('AZURE_MAPS_KEY', '');
    expect(geocodingEnabled()).toBe(false);
    expect(getConfiguredProvider()).toBeNull();
  });

  it('is enabled only when the flag is exactly "true" and a key exists', () => {
    vi.stubEnv('ADDRESS_GEOCODING_ENABLED', 'true');
    vi.stubEnv('AZURE_MAPS_KEY', 'server-key');
    expect(geocodingEnabled()).toBe(true);
    expect(getConfiguredProvider()).not.toBeNull();
  });

  it('a lookup with the flag off performs NO provider call (provider is null)', async () => {
    vi.stubEnv('ADDRESS_GEOCODING_ENABLED', 'false');
    vi.stubEnv('AZURE_MAPS_KEY', 'server-key');
    const r = await computeAddressGeocode({ provider: getConfiguredProvider(), fullAddress: 'הרצל 10, תל אביב' });
    expect(r.apply).toBeNull(); // create → column default NOT_REQUESTED, no network
  });
});
