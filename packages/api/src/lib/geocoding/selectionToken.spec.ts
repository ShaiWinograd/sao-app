import { describe, expect, it } from 'vitest';
import { signSelectionToken, verifySelectionToken, type SignSelectionInput } from './selectionToken.js';
import type { GeocodeAddressComponents } from './types.js';

const SECRET = 'test-selection-secret-0123456789';
const components: GeocodeAddressComponents = {
  streetName: 'ישעיהו',
  streetNumber: '22',
  municipality: 'רמת גן',
  postalCode: '5223392',
  countryCode: 'IL',
};

const input: SignSelectionInput = {
  provider: 'azure-maps',
  providerPlaceId: 'IL/PAD/p0/123',
  lat: 32.084,
  lon: 34.81,
  precision: 'HOUSE',
  confidence: 0.95,
  city: 'רמת גן',
  components,
  display: 'ישעיהו 22, רמת גן',
  ambiguous: false,
  query: 'ישעיהו 22 רמת גן',
};

describe('selection token', () => {
  it('round-trips a signed payload and preserves the server coordinates', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    const token = signSelectionToken(input, SECRET, { now });
    const res = verifySelectionToken(token, SECRET, now);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payload.lat).toBe(32.084);
    expect(res.payload.lon).toBe(34.81);
    expect(res.payload.providerPlaceId).toBe('IL/PAD/p0/123');
    expect(res.payload.components.postalCode).toBe('5223392');
    expect(res.payload.precision).toBe('HOUSE');
  });

  it('rejects a tampered payload (flipped coordinate) — signature fails', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    const token = signSelectionToken(input, SECRET, { now });
    const [body, sig] = token.split('.');
    // Forge the coordinates in the payload while keeping the original signature.
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), lat: 0, lon: 0 })).toString('base64url');
    const res = verifySelectionToken(`${forged}.${sig}`, SECRET, now);
    expect(res).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects a token signed with a different secret', () => {
    const now = new Date('2026-07-25T12:00:00Z');
    const token = signSelectionToken(input, SECRET, { now });
    expect(verifySelectionToken(token, 'a-completely-different-secret-9999', now)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('rejects an expired token', () => {
    const issued = new Date('2026-07-25T12:00:00Z');
    const token = signSelectionToken(input, SECRET, { now: issued, ttlSeconds: 60 });
    const later = new Date(issued.getTime() + 61_000);
    expect(verifySelectionToken(token, SECRET, later)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('rejects malformed tokens', () => {
    expect(verifySelectionToken('', SECRET).ok).toBe(false);
    expect(verifySelectionToken('no-dot', SECRET).ok).toBe(false);
    expect(verifySelectionToken('a.', SECRET).ok).toBe(false);
  });
});
