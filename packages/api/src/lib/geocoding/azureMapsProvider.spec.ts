import { describe, expect, it, vi } from 'vitest';
import { azureTypeToPrecision, createAzureMapsProvider, normalizeAzureResults, type FetchLike } from './azureMapsProvider.js';

// A canned Azure Maps `search/address/json` payload — no network, no real key.
function azurePayload() {
  return {
    results: [
      {
        type: 'Point Address',
        id: 'az-1',
        matchConfidence: { score: 0.94 },
        address: { freeformAddress: 'הרצל 10, תל אביב', municipality: 'תל אביב' },
        position: { lat: 32.06, lon: 34.77 },
      },
      {
        type: 'Street',
        id: 'az-2',
        matchConfidence: { score: 0.5 },
        address: { freeformAddress: 'הרצל, תל אביב', municipality: 'תל אביב' },
        position: { lat: 32.07, lon: 34.78 },
      },
    ],
  };
}

function mockFetch(status: number, body: any): { fetchImpl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

describe('azureTypeToPrecision', () => {
  it('maps Azure result types to neutral precision', () => {
    expect(azureTypeToPrecision('Point Address')).toBe('HOUSE');
    expect(azureTypeToPrecision('Address Range')).toBe('STREET');
    expect(azureTypeToPrecision('Street')).toBe('STREET');
    expect(azureTypeToPrecision('Cross Street')).toBe('STREET');
    expect(azureTypeToPrecision('Geography', 'Municipality')).toBe('LOCALITY');
    expect(azureTypeToPrecision('Geography', 'CountrySubdivision')).toBe('REGION');
    expect(azureTypeToPrecision('Postal Code Area')).toBe('REGION');
    expect(azureTypeToPrecision('POI')).toBe('OTHER');
    expect(azureTypeToPrecision(undefined)).toBe('OTHER');
  });
});

describe('normalizeAzureResults', () => {
  it('produces provider-neutral candidates with confidence from matchConfidence.score', () => {
    const [first, second] = normalizeAzureResults(azurePayload());
    expect(first).toMatchObject({ provider: 'azure-maps', providerPlaceId: 'az-1', precision: 'HOUSE', city: 'תל אביב', latitude: 32.06, longitude: 34.77, confidence: 0.94 });
    expect(second.precision).toBe('STREET');
    expect(second.confidence).toBe(0.5);
  });

  it('defaults missing confidence to 0 (never silently trusted) and drops result-less entries', () => {
    const c = normalizeAzureResults({ results: [{ type: 'Point Address', address: { municipality: 'x' }, position: { lat: 1, lon: 2 } }, { type: 'Point Address' }] });
    expect(c).toHaveLength(1);
    expect(c[0].confidence).toBe(0);
  });

  it('handles an empty/absent payload', () => {
    expect(normalizeAzureResults({})).toEqual([]);
    expect(normalizeAzureResults(null)).toEqual([]);
  });
});

describe('createAzureMapsProvider.geocode', () => {
  it('returns ok candidates on a 200 and sends the key as subscription-key (not in the browser)', async () => {
    const { fetchImpl, calls } = mockFetch(200, azurePayload());
    const provider = createAzureMapsProvider({ apiKey: 'test-key', fetchImpl });
    const res = await provider.geocode({ fullAddress: 'הרצל 10, תל אביב' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.candidates).toHaveLength(2);
    expect(calls[0]).toContain('subscription-key=test-key');
    expect(calls[0]).toContain('/search/address/json');
  });

  it('classifies 429 and 5xx as TRANSIENT (retryable)', async () => {
    for (const status of [429, 500, 503]) {
      const { fetchImpl } = mockFetch(status, {});
      const res = await createAzureMapsProvider({ apiKey: 'k', fetchImpl }).geocode({ fullAddress: 'x' });
      expect(res).toEqual({ ok: false, error: { kind: 'TRANSIENT', message: expect.any(String) } });
    }
  });

  it('classifies 401/403 as CONFIG and other 4xx as PROVIDER', async () => {
    const auth = await createAzureMapsProvider({ apiKey: 'k', fetchImpl: mockFetch(403, {}).fetchImpl }).geocode({ fullAddress: 'x' });
    expect(auth).toMatchObject({ ok: false, error: { kind: 'CONFIG' } });
    const bad = await createAzureMapsProvider({ apiKey: 'k', fetchImpl: mockFetch(400, {}).fetchImpl }).geocode({ fullAddress: 'x' });
    expect(bad).toMatchObject({ ok: false, error: { kind: 'PROVIDER' } });
  });

  it('maps a network throw to TRANSIENT', async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    const res = await createAzureMapsProvider({ apiKey: 'k', fetchImpl }).geocode({ fullAddress: 'x' });
    expect(res).toMatchObject({ ok: false, error: { kind: 'TRANSIENT' } });
  });

  it('maps an abort/timeout to TRANSIENT', async () => {
    const fetchImpl: FetchLike = async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    };
    const res = await createAzureMapsProvider({ apiKey: 'k', fetchImpl }).geocode({ fullAddress: 'x' });
    expect(res).toMatchObject({ ok: false, error: { kind: 'TRANSIENT', message: 'Azure Maps timeout' } });
  });

  it('returns CONFIG when the key is missing and never calls the network', async () => {
    const spy = vi.fn();
    const res = await createAzureMapsProvider({ apiKey: '', fetchImpl: spy as any }).geocode({ fullAddress: 'x' });
    expect(res).toMatchObject({ ok: false, error: { kind: 'CONFIG' } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns INVALID_QUERY for an empty address without calling the network', async () => {
    const spy = vi.fn();
    const res = await createAzureMapsProvider({ apiKey: 'k', fetchImpl: spy as any }).geocode({ fullAddress: '   ' });
    expect(res).toMatchObject({ ok: false, error: { kind: 'INVALID_QUERY' } });
    expect(spy).not.toHaveBeenCalled();
  });
});
