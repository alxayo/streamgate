/**
 * Simple sliding window rate limiter (in-memory, PDR §12).
 * Keyed by identifier (IP address or token code).
 */
interface RateLimitEntry {
  timestamps: number[];
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(config: { maxRequests: number; windowMs: number }) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  /**
   * Check if the key is rate-limited. Returns true if the request is allowed.
   * If allowed, records the request.
   */
  check(key: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const entry = this.store.get(key) ?? { timestamps: [] };

    // Remove timestamps outside the window
    entry.timestamps = entry.timestamps.filter((t) => t > now - this.windowMs);

    if (entry.timestamps.length >= this.maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + this.windowMs - now;
      return { allowed: false, retryAfterMs };
    }

    entry.timestamps.push(now);
    this.store.set(key, entry);
    return { allowed: true };
  }

  /**
   * Periodically clean up expired entries.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      entry.timestamps = entry.timestamps.filter((t) => t > now - this.windowMs);
      if (entry.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }
}
