const WINDOW_MS = 60_000;

/**
 * Counts requests per key over the last minute, in memory. The API runs as
 * one process, so a restart resetting the counts is acceptable.
 */
export const createRateLimiter = (perMinute: number) => {
  const hits = new Map<string, number[]>();
  return {
    /** Records a request; false when the key is over its limit. */
    allow(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter(
        (time) => time > now - WINDOW_MS
      );
      if (recent.length >= perMinute) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    /** Seconds until the key may call again. */
    retryAfterSeconds(key: string, now = Date.now()): number {
      const oldest = hits.get(key)?.[0];
      return oldest
        ? Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000))
        : 1;
    },
  };
};
