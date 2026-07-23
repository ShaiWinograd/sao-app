import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, decideGeocode, normalizeCity } from './decision.js';
import type { GeocodeCandidate, GeocodeProviderResponse, GeocodeQuery, ResultPrecision } from './types.js';

function candidate(over: Partial<GeocodeCandidate> = {}): GeocodeCandidate {
  return {
    provider: 'azure-maps',
    providerPlaceId: 'p1',
    formattedAddress: 'הרצל 10, תל אביב',
    latitude: 32.06,
    longitude: 34.77,
    precision: 'HOUSE',
    city: 'תל אביב',
    confidence: 0.95,
    ...over,
  };
}
const ok = (candidates: GeocodeCandidate[]): GeocodeProviderResponse => ({ ok: true, candidates });
const query: GeocodeQuery = { fullAddress: 'הרצל 10, תל אביב', city: 'תל אביב' };

describe('decideGeocode — RESOLVED', () => {
  it('resolves an unambiguous, house-level, in-city, high-confidence match', () => {
    const d = decideGeocode(query, ok([candidate()]));
    expect(d.status).toBe('RESOLVED');
    expect(d.reason).toBe('RESOLVED_EXACT');
    expect(d.candidate?.providerPlaceId).toBe('p1');
    expect(d.transient).toBe(false);
  });

  it('picks the highest-confidence candidate when the runner-up is clearly weaker', () => {
    const d = decideGeocode(query, ok([candidate({ confidence: 0.6, providerPlaceId: 'low' }), candidate({ confidence: 0.95, providerPlaceId: 'high' })]));
    expect(d.status).toBe('RESOLVED');
    expect(d.candidate?.providerPlaceId).toBe('high');
  });
});

describe('decideGeocode — NEEDS_REVIEW (never activates monitoring)', () => {
  const cases: Array<[string, GeocodeProviderResponse, string]> = [
    ['city centroid', ok([candidate({ precision: 'LOCALITY' })]), 'CENTROID_RESULT'],
    ['region centroid', ok([candidate({ precision: 'REGION' })]), 'CENTROID_RESULT'],
    ['street-level (house required)', ok([candidate({ precision: 'STREET' })]), 'NOT_HOUSE_LEVEL'],
    ['non-address (POI/other)', ok([candidate({ precision: 'OTHER' })]), 'NOT_HOUSE_LEVEL'],
    ['ambiguous close runner-up', ok([candidate({ confidence: 0.9, providerPlaceId: 'a' }), candidate({ confidence: 0.85, providerPlaceId: 'b' })]), 'AMBIGUOUS'],
    ['different city', ok([candidate({ city: 'חיפה' })]), 'CITY_MISMATCH'],
    ['low confidence', ok([candidate({ confidence: 0.6 })]), 'LOW_CONFIDENCE'],
  ];
  it.each(cases)('flags %s as NEEDS_REVIEW (%s)', (_name, response, reason) => {
    const d = decideGeocode(query, response);
    expect(d.status).toBe('NEEDS_REVIEW');
    expect(d.reason).toBe(reason);
    expect(d.transient).toBe(false);
    expect(d.candidate).not.toBeNull(); // owner can review/select
  });

  it('coarse results are downgraded even when requireHouseLevel is false', () => {
    const relaxed: GeocodeQuery = { ...query, requireHouseLevel: false };
    expect(decideGeocode(relaxed, ok([candidate({ precision: 'LOCALITY' })])).reason).toBe('CENTROID_RESULT');
    // ...but a street-level match may resolve when house precision is not required.
    expect(decideGeocode(relaxed, ok([candidate({ precision: 'STREET' })])).status).toBe('RESOLVED');
  });
});

describe('decideGeocode — FAILED (transient vs terminal)', () => {
  it('returns transient=true only for a retryable provider outage', () => {
    const d = decideGeocode(query, { ok: false, error: { kind: 'TRANSIENT', message: 'x' } });
    expect(d.status).toBe('FAILED');
    expect(d.reason).toBe('PROVIDER_UNAVAILABLE');
    expect(d.transient).toBe(true);
  });

  it('maps terminal provider errors to non-transient FAILED', () => {
    expect(decideGeocode(query, { ok: false, error: { kind: 'CONFIG', message: 'x' } })).toMatchObject({ status: 'FAILED', reason: 'CONFIG_ERROR', transient: false });
    expect(decideGeocode(query, { ok: false, error: { kind: 'PROVIDER', message: 'x' } })).toMatchObject({ status: 'FAILED', reason: 'PROVIDER_ERROR', transient: false });
    expect(decideGeocode(query, { ok: false, error: { kind: 'INVALID_QUERY', message: 'x' } })).toMatchObject({ status: 'FAILED', reason: 'INVALID_QUERY', transient: false });
  });

  it('an empty result set is a terminal NO_MATCH, not transient', () => {
    const d = decideGeocode(query, ok([]));
    expect(d).toMatchObject({ status: 'FAILED', reason: 'NO_MATCH', transient: false });
  });

  it('keeps a transient outage distinguishable from a valid low-confidence result', () => {
    const outage = decideGeocode(query, { ok: false, error: { kind: 'TRANSIENT', message: 'x' } });
    const weak = decideGeocode(query, ok([candidate({ confidence: 0.5 })]));
    expect(outage.status).toBe('FAILED');
    expect(outage.transient).toBe(true);
    expect(weak.status).toBe('NEEDS_REVIEW');
    expect(weak.transient).toBe(false);
  });
});

describe('normalizeCity', () => {
  it('treats niqqud, quotes and whitespace variants as equal', () => {
    expect(normalizeCity(' תֵּל   אָבִיב ')).toBe(normalizeCity('תל אביב'));
    expect(normalizeCity('פתח־תקווה'.replace('־', ' '))).toBe(normalizeCity('פתח תקווה'));
  });
  it('distinguishes genuinely different cities', () => {
    expect(normalizeCity('תל אביב')).not.toBe(normalizeCity('חיפה'));
  });
});

describe('thresholds', () => {
  it('exposes conservative defaults', () => {
    expect(DEFAULT_THRESHOLDS.resolvedMinConfidence).toBe(0.8);
    expect(DEFAULT_THRESHOLDS.ambiguityDelta).toBe(0.1);
  });
  it('honors a custom ambiguity delta', () => {
    const resp = { ok: true as const, candidates: [candidate({ confidence: 0.95, providerPlaceId: 'a' }), candidate({ confidence: 0.8, providerPlaceId: 'b' })] };
    // delta 0.15 → not ambiguous under a 0.1 window, ambiguous under a 0.2 window.
    expect(decideGeocode(query, resp, { resolvedMinConfidence: 0.8, ambiguityDelta: 0.1 }).status).toBe('RESOLVED');
    expect(decideGeocode(query, resp, { resolvedMinConfidence: 0.8, ambiguityDelta: 0.2 }).reason).toBe('AMBIGUOUS');
  });
});

// Guard: the precision union stays in sync with the decision branches.
const _precisions: ResultPrecision[] = ['HOUSE', 'STREET', 'LOCALITY', 'REGION', 'OTHER'];
