/**
 * Prevents duplicate concurrent fetches for the same upstream segment (PDR §6.3).
 * When multiple viewers request the same uncached segment simultaneously,
 * only one upstream fetch is initiated.
 */
export class InflightDeduplicator {
  private readonly inflight = new Map<string, Promise<Buffer>>();

  /**
   * Get or initiate a fetch. If a fetch for this key is already in-flight,
   * returns the existing promise. Otherwise, executes the fetcher and
   * shares the result with all concurrent callers.
   */
  async getOrFetch(key: string, fetcher: () => Promise<Buffer>): Promise<Buffer> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = fetcher().finally(() => {
      this.inflight.delete(key);
    });

    this.inflight.set(key, promise);
    return promise;
  }
}
