/**
 * In-memory revocation cache (PDR §4.4).
 * Maps revoked access token codes to their revocation timestamps.
 */
export class RevocationCache {
  private readonly cache = new Map<string, number>();

  /** Check if a token code is revoked. */
  isRevoked(code: string): boolean {
    return this.cache.has(code);
  }

  /** Add a revoked code to the cache. */
  add(code: string, revokedAtMs: number): void {
    this.cache.set(code, revokedAtMs);
  }

  /** Add multiple revoked codes at once. */
  addBatch(entries: Array<{ code: string; revokedAtMs: number }>): void {
    for (const entry of entries) {
      this.cache.set(entry.code, entry.revokedAtMs);
    }
  }

  /** Remove entries older than maxAgeMs (expired tokens no longer need tracking). */
  evictOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let evicted = 0;
    for (const [code, timestamp] of this.cache) {
      if (timestamp < cutoff) {
        this.cache.delete(code);
        evicted++;
      }
    }
    return evicted;
  }

  /** Current cache size (for health endpoint). */
  get size(): number {
    return this.cache.size;
  }
}
