import type { RevocationSyncResponse } from '@streaming/shared';
import { RevocationCache } from './revocation-cache.js';
import type { ServerConfig } from '../config.js';

/**
 * Background service that polls Platform App for revocations (PDR §4.4).
 */
export class RevocationSyncService {
  private lastSyncTimestamp: string;
  private lastSuccessfulSync: number = Date.now();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly cache: RevocationCache;
  private readonly config: ServerConfig;

  constructor(cache: RevocationCache, config: ServerConfig) {
    this.cache = cache;
    this.config = config;
    this.lastSyncTimestamp = new Date(0).toISOString();
  }

  /** Start the background polling loop. */
  start(): void {
    this.sync();
    this.intervalId = setInterval(() => this.sync(), this.config.revocationPollIntervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Perform a single sync cycle. */
  private async sync(): Promise<void> {
    try {
      const url = new URL('/api/revocations', this.config.platformAppUrl);
      url.searchParams.set('since', this.lastSyncTimestamp);

      const response = await fetch(url.toString(), {
        headers: {
          'X-Internal-Api-Key': this.config.internalApiKey,
        },
      });

      if (!response.ok) {
        console.error(`Revocation sync failed: HTTP ${response.status}`);
        this.checkSyncHealth();
        return;
      }

      const data: RevocationSyncResponse = await response.json();

      // Add individually revoked tokens
      for (const rev of data.revocations) {
        this.cache.add(rev.code, new Date(rev.revokedAt).getTime());
      }

      // Add tokens from deactivated events
      for (const deactivation of data.eventDeactivations) {
        const ts = new Date(deactivation.deactivatedAt).getTime();
        for (const code of deactivation.tokenCodes) {
          this.cache.add(code, ts);
        }
      }

      this.lastSyncTimestamp = data.serverTime;
      this.lastSuccessfulSync = Date.now();
    } catch (error) {
      console.error('Revocation sync error:', error);
      this.checkSyncHealth();
    }
  }

  /** Alert if sync has been failing for too long (PDR §4.4: alert after 5 min). */
  private checkSyncHealth(): void {
    const failureDuration = Date.now() - this.lastSuccessfulSync;
    if (failureDuration > 5 * 60 * 1000) {
      console.error(
        `ALERT: Revocation sync has been failing for ${Math.floor(failureDuration / 1000)}s`,
      );
    }
  }

  /** Seconds since last successful sync (for health endpoint). */
  get lastSyncAgoSeconds(): number {
    return Math.floor((Date.now() - this.lastSuccessfulSync) / 1000);
  }
}
