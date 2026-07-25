import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rateLimiter.js';

describe('rate limiter', () => {
  it('allows up to the limit within the window, then blocks', () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    const t = 10_000;
    expect(rl.take('u1', t)).toBe(true);
    expect(rl.take('u1', t + 10)).toBe(true);
    expect(rl.take('u1', t + 20)).toBe(true);
    expect(rl.take('u1', t + 30)).toBe(false); // 4th within the window
  });

  it('resets after the window slides past old hits', () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000 });
    const t = 10_000;
    expect(rl.take('u1', t)).toBe(true);
    expect(rl.take('u1', t + 100)).toBe(true);
    expect(rl.take('u1', t + 200)).toBe(false);
    // Slide the window past both hits.
    expect(rl.take('u1', t + 1300)).toBe(true);
  });

  it('tracks keys independently', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000 });
    const t = 10_000;
    expect(rl.take('a', t)).toBe(true);
    expect(rl.take('b', t)).toBe(true);
    expect(rl.take('a', t)).toBe(false);
  });
});
