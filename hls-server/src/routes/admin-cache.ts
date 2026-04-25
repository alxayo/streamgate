import { Router } from 'express';
import type { Request, Response } from 'express';
import type { SegmentCache } from '../services/segment-cache.js';
import type { UpstreamProxy } from '../services/upstream-proxy.js';
import type { ServerConfig } from '../config.js';

export function createAdminCacheRoute(
  segmentCache: SegmentCache,
  upstreamProxy: UpstreamProxy | null,
  config: ServerConfig,
) {
  const router = Router();

  router.delete('/admin/cache/:eventId', async (req: Request, res: Response) => {
    const apiKey = req.headers['x-internal-api-key'];
    if (apiKey !== config.internalApiKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const eventId = req.params.eventId as string;

    try {
      // 1. Clear local segment cache (Azure Files or local disk)
      await segmentCache.clearEvent(eventId);

      // 2. Clear local stream root files if in local/hybrid mode
      if (config.streamRoot) {
        const path = await import('node:path');
        const fs = await import('node:fs/promises');
        const dirName = config.streamKeyPrefix + eventId;
        const eventDir = path.join(config.streamRoot, dirName);
        await fs.rm(eventDir, { recursive: true, force: true }).catch(() => {});
      }

      // 3. Delete upstream blobs if proxy is configured
      let deletedBlobs = 0;
      if (upstreamProxy) {
        try {
          deletedBlobs = await upstreamProxy.deleteUpstreamBlobs(eventId);
        } catch (error) {
          console.error(`Failed to delete upstream blobs for ${eventId}:`, error);
        }
      }

      res.status(200).json({ deletedCache: true, deletedBlobs });
    } catch (error) {
      console.error(`Failed to purge event ${eventId}:`, error);
      res.status(500).json({ error: 'Failed to purge event data' });
    }
  });

  return router;
}
