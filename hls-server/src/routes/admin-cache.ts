import { Router } from 'express';
import type { Request, Response } from 'express';
import type { SegmentCache } from '../services/segment-cache.js';
import type { ServerConfig } from '../config.js';

export function createAdminCacheRoute(segmentCache: SegmentCache, config: ServerConfig) {
  const router = Router();

  router.delete('/admin/cache/:eventId', (req: Request, res: Response) => {
    const apiKey = req.headers['x-internal-api-key'];
    if (apiKey !== config.internalApiKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const eventId = req.params.eventId as string;
    segmentCache
      .clearEvent(eventId)
      .then(() => {
        res.status(204).end();
      })
      .catch(() => {
        res.status(500).json({ error: 'Failed to clear cache' });
      });
  });

  return router;
}
