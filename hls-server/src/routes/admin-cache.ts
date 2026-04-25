import { Router } from 'express';
import type { Request, Response } from 'express';
import type { SegmentCache } from '../services/segment-cache.js';
import type { UpstreamProxy } from '../services/upstream-proxy.js';
import type { ServerConfig } from '../config.js';
import { asyncHandler } from '../middleware/error-handler.js';

export function createAdminCacheRoute(
  segmentCache: SegmentCache,
  upstreamProxy: UpstreamProxy | null,
  config: ServerConfig,
) {
  const router = Router();

  router.delete('/admin/cache/:eventId', asyncHandler(async (req: Request, res: Response) => {
    const apiKey = req.headers['x-internal-api-key'];
    if (apiKey !== config.internalApiKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const eventId = req.params.eventId as string;
    console.log(`[admin-cache] Purge started for event ${eventId}`);

    try {
      // 1. Clear local segment cache (Azure Files or local disk)
      await segmentCache.clearEvent(eventId);
      console.log(`[admin-cache] Cleared segment cache for ${eventId}`);

      // 2. Clear local stream root files if in local/hybrid mode
      if (config.streamRoot) {
        const path = await import('node:path');
        const fs = await import('node:fs/promises');
        const dirName = config.streamKeyPrefix + eventId;
        const eventDir = path.join(config.streamRoot, dirName);
        await fs.rm(eventDir, { recursive: true, force: true }).catch(() => {});
        console.log(`[admin-cache] Cleared stream root for ${eventId}`);
      }

      // 3. Delete upstream blobs if proxy is configured
      let deletedBlobs = 0;
      if (upstreamProxy) {
        try {
          deletedBlobs = await upstreamProxy.deleteUpstreamBlobs(eventId);
          console.log(`[admin-cache] Deleted ${deletedBlobs} upstream blobs for ${eventId}`);
        } catch (error) {
          console.error(`Failed to delete upstream blobs for ${eventId}:`, error);
        }
      }

      const body = JSON.stringify({ deletedCache: true, deletedBlobs });
      console.log(`[admin-cache] Sending 200 response for ${eventId}: ${body}, headersSent=${res.headersSent}`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    } catch (error) {
      console.error(`Failed to purge event ${eventId}:`, error);
      if (!res.headersSent) {
        const errBody = JSON.stringify({ error: 'Failed to purge event data' });
        res.writeHead(500, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(errBody) });
        res.end(errBody);
      }
    }
  }));

  return router;
}
