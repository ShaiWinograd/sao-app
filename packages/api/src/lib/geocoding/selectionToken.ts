// Server-signed address-selection token (PR-A). When the owner picks a suggestion,
// the client holds ONLY this opaque token — never raw coordinates. The token binds
// the server's own Azure result (coordinates, structured components, precision,
// provider place id, the query it answered, issued-at + expiry) under an HMAC so
// that on submit the server can:
//   1. verify the signature (the payload is exactly what the server issued — the
//      client cannot forge or tamper coordinates), and
//   2. re-run the geocode decision rules on the bound candidate.
//
// SECRET: a DEDICATED server-side signing secret (`GEOCODE_SELECTION_SECRET`).
// It is never the Azure Maps key and is never exposed to the browser/mobile.
//
// Format: `<base64url(json payload)>.<base64url(hmac-sha256)>` — compact, opaque,
// and self-describing without a datastore (no schema change, no server cache).

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GeocodeAddressComponents, ResultPrecision } from './types.js';

/** The signed, tamper-proof description of one server-vetted candidate. */
export interface SelectionTokenPayload {
  /** Schema version, so the format can evolve. */
  v: 1;
  provider: string;
  /** Provider result id when available (Azure v1 ids are ephemeral — never the sole key). */
  providerPlaceId: string | null;
  /** Server-returned coordinates. Trusted because they are inside a server HMAC. */
  lat: number;
  lon: number;
  precision: ResultPrecision;
  confidence: number;
  city: string | null;
  components: GeocodeAddressComponents;
  /** Clean display built from validated structured fields (what the owner saw/selected). */
  display: string;
  /** Whether the server judged this candidate ambiguous against its siblings at suggest time. */
  ambiguous: boolean;
  /** The search text this candidate answered — candidate/query identity. */
  query: string;
  /** Issued-at (epoch seconds). */
  iat: number;
  /** Expiry (epoch seconds). */
  exp: number;
}

const DEFAULT_TTL_SECONDS = 15 * 60; // 15 minutes

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sign(body: string, secret: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(body).digest());
}

/** The signing secret, or null when unconfigured (search/selection is then disabled). */
export function getSelectionSecret(): string | null {
  const s = process.env.GEOCODE_SELECTION_SECRET;
  return s && s.length >= 16 ? s : null;
}

export interface SignSelectionInput {
  provider: string;
  providerPlaceId: string | null;
  lat: number;
  lon: number;
  precision: ResultPrecision;
  confidence: number;
  city: string | null;
  components: GeocodeAddressComponents;
  display: string;
  ambiguous: boolean;
  query: string;
}

/** Issue a signed selection token for a server-vetted candidate. */
export function signSelectionToken(
  input: SignSelectionInput,
  secret: string,
  opts: { now?: Date; ttlSeconds?: number } = {},
): string {
  const iat = Math.floor((opts.now?.getTime() ?? Date.now()) / 1000);
  const payload: SelectionTokenPayload = {
    v: 1,
    provider: input.provider,
    providerPlaceId: input.providerPlaceId,
    lat: input.lat,
    lon: input.lon,
    precision: input.precision,
    confidence: input.confidence,
    city: input.city,
    components: input.components,
    display: input.display,
    ambiguous: input.ambiguous,
    query: input.query,
    iat,
    exp: iat + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${sign(body, secret)}`;
}

export type SelectionVerifyResult =
  | { ok: true; payload: SelectionTokenPayload }
  | { ok: false; reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' };

/**
 * Verify a selection token's signature and expiry. Never throws. A tampered
 * payload (any changed byte, including coordinates) fails the constant-time
 * signature check; an out-of-window token fails expiry.
 */
export function verifySelectionToken(token: string, secret: string, now: Date = new Date()): SelectionVerifyResult {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return { ok: false, reason: 'MALFORMED' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'MALFORMED' };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body, secret);
  const a = b64urlDecode(sig);
  const b = b64urlDecode(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'BAD_SIGNATURE' };

  let payload: SelectionTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (payload?.v !== 1 || typeof payload.exp !== 'number') return { ok: false, reason: 'MALFORMED' };

  const nowSec = Math.floor(now.getTime() / 1000);
  if (nowSec >= payload.exp) return { ok: false, reason: 'EXPIRED' };

  return { ok: true, payload };
}
