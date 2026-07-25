import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { getSelectionSecret, signSelectionToken, verifySelectionToken, type SignSelectionInput } from './selectionToken.js';
import type { GeocodeAddressComponents } from './types.js';

const SECRET = 'test-selection-secret-0123456789';
const components: GeocodeAddressComponents = {
  streetName: 'ישעיהו',
  streetNumber: '22',
  municipality: 'רמת גן',
  postalCode: '5223392',
  countryCode: 'IL',
};

// Sign an ARBITRARY payload object with the real secret — used to test that shape
// and numeric-bounds validation reject correctly-signed-but-invalid payloads.
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function forgeSigned(payload: Record<string, unknown>, secret = SECRET): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}
function basePayload(iat = 1_900_000_000): Record<string, unknown> {
  return { v: 1, provider: 'azure-maps', providerPlaceId: 'p', lat: 32.08, lon: 34.81, precision: 'HOUSE', confidence: 0.9, city: 'רמת גן', components, display: 'ישעיהו 22, רמת גן', ambiguous: false, query: 'q', iat, exp: iat + 900 };
}
const atSec = (s: number) => new Date(s * 1000);

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

describe('selection token — payload shape + numeric bounds (post-signature)', () => {
  const now = atSec(1_900_000_100);

  it('accepts a well-formed signed payload (sanity)', () => {
    expect(verifySelectionToken(forgeSigned(basePayload()), SECRET, now).ok).toBe(true);
  });

  it('rejects out-of-range coordinates even when correctly signed', () => {
    expect(verifySelectionToken(forgeSigned({ ...basePayload(), lat: 99 }), SECRET, now)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifySelectionToken(forgeSigned({ ...basePayload(), lon: 200 }), SECRET, now)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('rejects confidence outside [0,1]', () => {
    expect(verifySelectionToken(forgeSigned({ ...basePayload(), confidence: 1.5 }), SECRET, now)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('rejects an invalid precision', () => {
    expect(verifySelectionToken(forgeSigned({ ...basePayload(), precision: 'BOGUS' }), SECRET, now)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('rejects exp <= iat and an over-long TTL', () => {
    const iat = 1_900_000_000;
    expect(verifySelectionToken(forgeSigned({ ...basePayload(iat), exp: iat }), SECRET, now)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifySelectionToken(forgeSigned({ ...basePayload(iat), exp: iat + 7200 }), SECRET, now)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('rejects a token issued too far in the future (beyond clock-skew tolerance)', () => {
    const iat = 1_900_000_100 + 1000; // 1000s in the future relative to `now`
    expect(verifySelectionToken(forgeSigned({ ...basePayload(iat) }), SECRET, now)).toEqual({ ok: false, reason: 'MALFORMED' });
  });
});

describe('getSelectionSecret — strong secret required', () => {
  const KEY = 'GEOCODE_SELECTION_SECRET';
  it('returns null for a missing or short (<32 byte) secret and the value for a strong one', () => {
    const prev = process.env[KEY];
    try {
      delete process.env[KEY];
      expect(getSelectionSecret()).toBeNull();
      process.env[KEY] = 'too-short';
      expect(getSelectionSecret()).toBeNull();
      process.env[KEY] = 'x'.repeat(32);
      expect(getSelectionSecret()).toBe('x'.repeat(32));
    } finally {
      if (prev === undefined) delete process.env[KEY];
      else process.env[KEY] = prev;
    }
  });
});
