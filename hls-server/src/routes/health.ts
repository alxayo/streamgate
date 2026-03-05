import { Router } from 'express';
import type { Request, Response } from 'express';
import type { RevocationCache } from '../services/revocation-cache.js';
import type { RevocationSyncService } from '../services/revocation-sync.js';
import type { SegmentCache } from '../services/segment-cache.js';

export function createHealthRoute(
  revocationCache: RevocationCache,
  syncService: RevocationSyncService,
  segmentCache: SegmentCache,
) {
  const router = Router();

  router.get('/health', async (_req: Request, res: Response) => {
    const cacheStats = await segmentCache.getStats();
    res.json({
      status: 'ok',
      revocationCacheSize: revocationCache.size,
      lastSyncAgo: `${syncService.lastSyncAgoSeconds}s`,
      segmentCacheEvents: cacheStats.eventCount,
      segmentCacheSizeMB: cacheStats.sizeMB,
    });
  });

  return router;
}
