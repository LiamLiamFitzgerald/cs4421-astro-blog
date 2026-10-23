/**
 * A fixed-window limit per key (ADR-019): at most `limit` hits per `windowMs`.
 * It lives in one server instance's memory, so on Lambda each instance counts
 * separately; it stops a single noisy client, and the concurrency cap and the
 * DynamoDB capacity bound the rest.
 */
export interface RateLimiter {
  /** Records a hit; false when the key is over its limit for this window. */
  allow(key: string): boolean;
}

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = 10_000): RateLimiter {
  const windows = new Map<string, { start: number; hits: number }>();
  return {
    allow(key) {
      const t = now();
      const current = windows.get(key);
      if (!current || t - current.start >= windowMs) {
        if (windows.size >= maxKeys) windows.clear(); // bound memory under a flood of keys
        windows.set(key, { start: t, hits: 1 });
        return limit >= 1;
      }
      current.hits += 1;
      return current.hits <= limit;
    },
  };
}
