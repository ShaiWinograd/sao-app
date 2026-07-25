import { describe, expect, it } from 'vitest';
import { normalizeAzureResults } from './azureMapsProvider.js';
import { buildDisplayAddress, buildSuggestions, isExactHouse, MAX_SUGGESTIONS } from './suggest.js';
import { verifySelectionToken } from './selectionToken.js';
import type { GeocodeCandidate, GeocodeProvider, GeocodeProviderResponse } from './types.js';

const SECRET = 'test-selection-secret-0123456789';

function fakeProvider(response: GeocodeProviderResponse): GeocodeProvider {
  return { name: 'fake', geocode: async () => response };
}

function house(over: Partial<GeocodeCandidate> = {}): GeocodeCandidate {
  return {
    provider: 'azure-maps',
    providerPlaceId: 'p-house',
    formattedAddress: 'רחוב ישעיהו, 5223392, רמת גן, 22',
    latitude: 32.084,
    longitude: 34.81,
    precision: 'HOUSE',
    city: 'רמת גן',
    confidence: 0.96,
    components: { streetName: 'ישעיהו', streetNumber: '22', municipality: 'רמת גן', postalCode: '5223392', countryCode: 'IL' },
    ...over,
  };
}

describe('structured normalization', () => {
  it('extracts structured components from an Azure result', () => {
    const payload = {
      results: [
        {
          id: 'IL/PAD/p0/1',
          type: 'Point Address',
          position: { lat: 32.084, lon: 34.81 },
          matchConfidence: { score: 0.97 },
          address: {
            freeformAddress: 'רחוב ישעיהו, 5223392, רמת גן, 22',
            streetName: 'ישעיהו',
            streetNumber: '22',
            municipality: 'רמת גן',
            postalCode: '5223392',
            countryCode: 'IL',
          },
        },
      ],
    };
    const [c] = normalizeAzureResults(payload);
    expect(c.components).toEqual({ streetName: 'ישעיהו', streetNumber: '22', municipality: 'רמת גן', postalCode: '5223392', countryCode: 'IL' });
    expect(c.precision).toBe('HOUSE');
  });

  it('builds a clean display and EXCLUDES the postal code from the street/number line', () => {
    const display = buildDisplayAddress({ streetName: 'ישעיהו', streetNumber: '22', municipality: 'רמת גן', postalCode: '5223392', countryCode: 'IL' });
    expect(display).toBe('ישעיהו 22, רמת גן');
    expect(display).not.toContain('5223392');
  });

  it('is exact only when both street name and house number are present', () => {
    expect(isExactHouse(house())).toBe(true);
    expect(isExactHouse(house({ components: { streetName: 'ישעיהו', streetNumber: null, municipality: 'רמת גן', postalCode: null, countryCode: 'IL' } }))).toBe(false);
  });
});

describe('buildSuggestions', () => {
  it('returns display-safe candidates with verifiable tokens and NO coordinates', async () => {
    const res = await buildSuggestions({ provider: fakeProvider({ ok: true, candidates: [house()] }), secret: SECRET, query: 'ישעיהו 22 רמת גן' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [c] = res.candidates;
    expect(c.exact).toBe(true);
    expect(c.precision).toBe('HOUSE');
    expect(c.displayAddress).toBe('ישעיהו 22, רמת גן');
    // No coordinates leak into the response shape.
    expect(Object.keys(c)).toEqual(['token', 'displayAddress', 'city', 'precision', 'exact']);
    const verified = verifySelectionToken(c.token, SECRET);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.payload.lat).toBe(32.084);
  });

  it('labels a point without a house number as approximate STREET (never exact)', async () => {
    const streetish = house({ providerPlaceId: 'p-street', components: { streetName: 'ישעיהו', streetNumber: null, municipality: 'רמת גן', postalCode: null, countryCode: 'IL' } });
    const res = await buildSuggestions({ provider: fakeProvider({ ok: true, candidates: [streetish] }), secret: SECRET, query: 'ישעיהו רמת גן' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.candidates[0].exact).toBe(false);
    expect(res.candidates[0].precision).toBe('STREET');
  });

  it('rejects a too-short query', async () => {
    const res = await buildSuggestions({ provider: fakeProvider({ ok: true, candidates: [house()] }), secret: SECRET, query: 'אב' });
    expect(res).toEqual({ ok: false, code: 'QUERY_TOO_SHORT' });
  });

  it('maps a transient provider outage to a retryable code', async () => {
    const res = await buildSuggestions({ provider: fakeProvider({ ok: false, error: { kind: 'TRANSIENT', message: 'x' } }), secret: SECRET, query: 'ישעיהו 22' });
    expect(res).toEqual({ ok: false, code: 'PROVIDER_UNAVAILABLE' });
  });

  it('caps the number of suggestions', async () => {
    const many = Array.from({ length: 12 }, (_, i) => house({ providerPlaceId: `p-${i}`, confidence: 0.9 - i * 0.01 }));
    const res = await buildSuggestions({ provider: fakeProvider({ ok: true, candidates: many }), secret: SECRET, query: 'ישעיהו רמת גן' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.candidates.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
  });
});
