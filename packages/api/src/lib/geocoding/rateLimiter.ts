// Minimal in-memory sliding-window rate limiter (PR-A) for the suggest endpoint.
// Keeps the Azure key server-side without pulling in a new dependency. Keyed by
// authenticated user id; the window and limit are small (typeahead is chatty but
// bounded). Best-effort per-process only — acceptable for abuse smoothing, not a
// security control. Pure + clock-injectable so it is deterministically testable.

export interface RateLimiter {
  /** Returns true when the call is allowed; false when the key is over its budget. */
  take(key: string, now?: number): boolean;
}

export function createRateLimiter(opts: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(key: string, now: number = Date.now()): boolean {
      const cutoff = now - opts.windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= opts.limit) {
        hits.set(key, recent); // keep the trimmed window
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      // Opportunistic cleanup so the map cannot grow unbounded across many keys.
      if (hits.size > 5000) {
        for (const [k, ts] of hits) {
          const kept = ts.filter((t) => t > cutoff);
          if (kept.length === 0) hits.delete(k);
          else hits.set(k, kept);
        }
      }
      return true;
    },
  };
}
