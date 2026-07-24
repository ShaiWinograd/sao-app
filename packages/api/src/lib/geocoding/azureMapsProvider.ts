// Azure Maps adapter for the geocoding provider boundary (PBI #217, PR-2).
//
// SECRET HANDLING: the Azure Maps subscription key is a SERVER-SIDE credential
// (`AZURE_MAPS_KEY`). It is only ever read where this adapter is constructed
// (server runtime, a later PR) and sent to Azure over the outbound request. It
// must never reach the browser/mobile bundle and is never logged here. The
// existing browser autocomplete uses a SEPARATE public `NEXT_PUBLIC_*` key.
//
// DORMANT: nothing instantiates this at runtime yet. Tests inject a fake key and
// a mocked fetch, so no real key and no network call are ever used in CI.

import type {
  GeocodeCandidate,
  GeocodeProvider,
  GeocodeProviderResponse,
  GeocodeQuery,
  ResultPrecision,
} from './types.js';

// Minimal fetch shape so this module does not depend on the DOM lib and stays
// trivially mockable in tests.
export type FetchLike = (
  url: string,
  init?: { signal?: unknown; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export interface AzureMapsProviderOptions {
  /** Server-side subscription key. Never expose to the browser/mobile. */
  apiKey: string;
  baseUrl?: string;
  countrySet?: string;
  language?: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const AZURE_BASE = 'https://atlas.microsoft.com';

/** Map an Azure Maps result `type` (+ geography `entityType`) to a neutral precision. */
export function azureTypeToPrecision(type: string | undefined, entityType?: string): ResultPrecision {
  switch (type) {
    case 'Point Address':
      return 'HOUSE';
    case 'Address Range':
    case 'Street':
    case 'Cross Street':
      return 'STREET';
    case 'Geography': {
      const region = new Set([
        'Country',
        'CountrySubdivision',
        'CountrySecondarySubdivision',
        'CountryTertiarySubdivision',
      ]);
      return region.has(entityType ?? '') ? 'REGION' : 'LOCALITY';
    }
    case 'Postal Code Area':
      return 'REGION';
    case 'Municipality':
    case 'MunicipalitySubdivision':
      return 'LOCALITY';
    default:
      return 'OTHER';
  }
}

function clamp01(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Normalize an Azure Maps `search/address/json` payload into provider-neutral
 * candidates. Confidence comes from Azure's per-result `matchConfidence.score`
 * (0..1); when absent it defaults to 0 so the decision layer treats it as
 * low-confidence (owner review) rather than silently trusting it.
 */
export function normalizeAzureResults(payload: any): GeocodeCandidate[] {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results
    .filter((r: any) => r?.position && typeof r.position.lat === 'number' && typeof r.position.lon === 'number')
    .map((r: any) => ({
      provider: 'azure-maps',
      providerPlaceId: r.id != null ? String(r.id) : null,
      formattedAddress: String(r.address?.freeformAddress ?? ''),
      latitude: Number(r.position.lat),
      longitude: Number(r.position.lon),
      precision: azureTypeToPrecision(r.type, r.entityType),
      city: r.address?.municipality != null ? String(r.address.municipality) : null,
      confidence: clamp01(r.matchConfidence?.score),
    }));
}

/** Create an Azure Maps–backed geocoding provider. */
export function createAzureMapsProvider(opts: AzureMapsProviderOptions): GeocodeProvider {
  const baseUrl = (opts.baseUrl ?? AZURE_BASE).replace(/\/+$/, '');
  const countrySet = opts.countrySet ?? 'IL';
  const language = opts.language ?? 'he-IL';
  const timeoutMs = opts.timeoutMs ?? 5000;
  const doFetch: FetchLike = opts.fetchImpl ?? ((globalThis as any).fetch as FetchLike);

  return {
    name: 'azure-maps',
    async geocode(query: GeocodeQuery): Promise<GeocodeProviderResponse> {
      if (!opts.apiKey) {
        return { ok: false, error: { kind: 'CONFIG', message: 'AZURE_MAPS_KEY is not configured' } };
      }
      const q = query.fullAddress?.trim();
      if (!q) {
        return { ok: false, error: { kind: 'INVALID_QUERY', message: 'Empty address' } };
      }

      const url = new URL(`${baseUrl}/search/address/json`);
      url.searchParams.set('api-version', '1.0');
      url.searchParams.set('subscription-key', opts.apiKey);
      url.searchParams.set('language', language);
      url.searchParams.set('countrySet', countrySet);
      url.searchParams.set('limit', '6');
      url.searchParams.set('query', q);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(url.toString(), { signal: controller.signal });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            return { ok: false, error: { kind: 'CONFIG', message: `Azure Maps auth failed (${res.status})` } };
          }
          if (res.status === 429 || res.status >= 500) {
            return { ok: false, error: { kind: 'TRANSIENT', message: `Azure Maps unavailable (${res.status})` } };
          }
          return { ok: false, error: { kind: 'PROVIDER', message: `Azure Maps error (${res.status})` } };
        }
        const payload = await res.json();
        return { ok: true, candidates: normalizeAzureResults(payload) };
      } catch (err: any) {
        // Network failure / timeout / abort — retryable.
        return { ok: false, error: { kind: 'TRANSIENT', message: err?.name === 'AbortError' ? 'Azure Maps timeout' : 'Azure Maps network error' } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
