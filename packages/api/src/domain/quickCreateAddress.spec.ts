import { describe, expect, it } from 'vitest';
import { resolveQuickCreateAddress } from './quickCreateAddress.js';
import { signSelectionToken, type SignSelectionInput } from '../lib/geocoding/selectionToken.js';
import type { GeocodeAddressComponents } from '../lib/geocoding/types.js';

const SECRET = 'test-selection-secret-0123456789';
const NOW = new Date('2026-07-25T12:00:00Z');
const components: GeocodeAddressComponents = { streetName: 'ישעיהו', streetNumber: '22', municipality: 'רמת גן', postalCode: '5223392', countryCode: 'IL' };

function token(over: Partial<SignSelectionInput> = {}, opts: { now?: Date; ttlSeconds?: number } = {}): string {
  const input: SignSelectionInput = {
    provider: 'azure-maps',
    providerPlaceId: 'p-1',
    lat: 32.084,
    lon: 34.81,
    precision: 'HOUSE',
    confidence: 0.95,
    city: 'רמת גן',
    components,
    display: 'ישעיהו 22, רמת גן',
    ambiguous: false,
    query: 'ישעיהו 22 רמת גן',
    ...over,
  };
  return signSelectionToken(input, SECRET, { now: opts.now ?? NOW, ttlSeconds: opts.ttlSeconds });
}

const deps = { provider: null, secret: SECRET, now: NOW };

describe('resolveQuickCreateAddress — selected', () => {
  it('creates a RESOLVED persistence with server coordinates from a valid exact token', async () => {
    const res = await resolveQuickCreateAddress({ address: { mode: 'selected', token: token() } }, deps);
    expect(res.fullAddress).toBe('ישעיהו 22, רמת גן');
    expect(res.apply).toMatchObject({
      geocodeStatus: 'RESOLVED',
      latitude: 32.084,
      longitude: 34.81,
      normalizedAddress: 'ישעיהו 22, רמת גן',
      geocodeProvider: 'azure-maps',
      geocodeProviderPlaceId: 'p-1',
      geocodeReason: 'RESOLVED_EXACT',
    });
  });

  it('does NOT silently create NEEDS_REVIEW for a low-precision selection — throws ADDRESS_NOT_RESOLVABLE', async () => {
    await expect(
      resolveQuickCreateAddress({ address: { mode: 'selected', token: token({ precision: 'STREET' }) } }, deps),
    ).rejects.toMatchObject({ statusCode: 422, code: 'ADDRESS_NOT_RESOLVABLE' });
  });

  it('rejects an ambiguous selection (no RESOLVED, no write)', async () => {
    await expect(
      resolveQuickCreateAddress({ address: { mode: 'selected', token: token({ ambiguous: true }) } }, deps),
    ).rejects.toMatchObject({ statusCode: 422, code: 'ADDRESS_NOT_RESOLVABLE' });
  });

  it('rejects a HOUSE token missing a house number (defense-in-depth)', async () => {
    const bad = token({ components: { ...components, streetNumber: null } });
    await expect(resolveQuickCreateAddress({ address: { mode: 'selected', token: bad } }, deps)).rejects.toMatchObject({ code: 'ADDRESS_NOT_RESOLVABLE' });
  });

  it('independently rechecks IL completeness — a signed HOUSE token missing municipality does not RESOLVE', async () => {
    const bad = token({ precision: 'HOUSE', components: { streetName: 'ישעיהו', streetNumber: '22', municipality: null, postalCode: null, countryCode: 'IL' } });
    await expect(resolveQuickCreateAddress({ address: { mode: 'selected', token: bad } }, deps)).rejects.toMatchObject({ code: 'ADDRESS_NOT_RESOLVABLE' });
  });

  it('independently rechecks country — a signed HOUSE token with a non-IL country does not RESOLVE', async () => {
    const bad = token({ precision: 'HOUSE', city: 'NYC', display: 'Main 5, NYC', components: { streetName: 'Main', streetNumber: '5', municipality: 'NYC', postalCode: null, countryCode: 'US' } });
    await expect(resolveQuickCreateAddress({ address: { mode: 'selected', token: bad } }, deps)).rejects.toMatchObject({ code: 'ADDRESS_NOT_RESOLVABLE' });
  });

  it('rejects a tampered token', async () => {
    const t = token();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), lat: 0 })).toString('base64url');
    await expect(
      resolveQuickCreateAddress({ address: { mode: 'selected', token: `${forged}.${sig}` } }, deps),
    ).rejects.toMatchObject({ statusCode: 400, code: 'ADDRESS_SELECTION_INVALID' });
  });

  it('rejects an expired token', async () => {
    const t = token({}, { now: NOW, ttlSeconds: 60 });
    const later = new Date(NOW.getTime() + 61_000);
    await expect(
      resolveQuickCreateAddress({ address: { mode: 'selected', token: t } }, { provider: null, secret: SECRET, now: later }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'ADDRESS_SELECTION_EXPIRED' });
  });

  it('returns a retryable config error when the signing secret is not configured', async () => {
    await expect(
      resolveQuickCreateAddress({ address: { mode: 'selected', token: token() } }, { provider: null, secret: null, now: NOW }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'GEOCODE_NOT_CONFIGURED' });
  });
});

describe('resolveQuickCreateAddress — manual', () => {
  it('creates NEEDS_REVIEW with null coordinates when explicitly confirmed', async () => {
    const res = await resolveQuickCreateAddress({ address: { mode: 'manual', text: 'ישעיהו 22 רמת גן', confirmedUnresolved: true } }, deps);
    expect(res.fullAddress).toBe('ישעיהו 22 רמת גן');
    expect(res.apply).toMatchObject({ geocodeStatus: 'NEEDS_REVIEW', latitude: null, longitude: null, geocodeReason: 'MANUAL_UNRESOLVED' });
  });

  it('requires confirmedUnresolved=true', async () => {
    await expect(
      resolveQuickCreateAddress({ address: { mode: 'manual', text: 'x', confirmedUnresolved: false as unknown as true } }, deps),
    ).rejects.toMatchObject({ code: 'MANUAL_CONFIRMATION_REQUIRED' });
  });
});

describe('resolveQuickCreateAddress — legacy + one-of', () => {
  it('keeps legacy behavior: free text with no provider stays NOT_REQUESTED (apply null)', async () => {
    const res = await resolveQuickCreateAddress({ cityOrAddress: '  תל אביב  ' }, { provider: null, secret: null, now: NOW });
    expect(res.fullAddress).toBe('תל אביב');
    expect(res.apply).toBeNull();
  });

  it('requires exactly one of cityOrAddress / address', async () => {
    await expect(resolveQuickCreateAddress({}, deps)).rejects.toMatchObject({ code: 'ADDRESS_REQUIRED' });
    await expect(
      resolveQuickCreateAddress({ cityOrAddress: 'x', address: { mode: 'manual', text: 'y', confirmedUnresolved: true } }, deps),
    ).rejects.toMatchObject({ code: 'ADDRESS_REQUIRED' });
  });
});
