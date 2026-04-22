import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types.js';
import type { ContentResolver } from '../services/content-resolver.js';
import type { UpstreamProxy } from '../services/upstream-proxy.js';
import type { SegmentCache } from '../services/segment-cache.js';
import type { InflightDeduplicator } from '../services/inflight-dedup.js';

const MIME_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.fmp4': 'video/mp4',
  '.mp4': 'video/mp4',
};

const ALLOWED_EXTENSIONS = new Set(['.m3u8', '.ts', '.fmp4', '.mp4']);

export function createStreamRoutes(
  contentResolver: ContentResolver,
  upstreamProxy: UpstreamProxy | null,
  segmentCache: SegmentCache,
  inflightDedup: InflightDeduplicator,
) {
  const router = Router();

  router.get('/streams/:eventId/*', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const eventId = req.params.eventId as string;
      // Express wildcard param
      const wildcardPath = req.params[0] as string | undefined;
      if (!wildcardPath) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const filename = wildcardPath;
      const ext = path.extname(filename).toLowerCase();

      // Validate file extension
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      const isManifest = ext === '.m3u8';

      // HEAD requests for probe JWTs (PDR §10.1)
      if (req.method === 'HEAD') {
        // Try local first
        const localPath = await contentResolver.resolveLocal(eventId, filename);
        if (localPath) {
          const stat = fs.statSync(localPath);
          res.set({
            'Content-Type': mimeType,
            'Content-Length': String(stat.size),
            'Last-Modified': stat.mtime.toUTCString(),
          });
          res.status(200).end();
          return;
        }

        // Try upstream
        if (upstreamProxy) {
          try {
            const upstream = await upstreamProxy.fetch(eventId, filename);
            res.set({
              'Content-Type': upstream.contentType,
              'Content-Length': String(upstream.data.length),
              ...(upstream.lastModified && { 'Last-Modified': upstream.lastModified }),
              ...(upstream.etag && { ETag: upstream.etag }),
            });
            res.status(200).end();
            return;
          } catch {
            // Fall through to 404
          }
        }

        res.status(404).json({ error: 'Not found' });
        return;
      }

      // 1. Check local files
      const localPath = await contentResolver.resolveLocal(eventId, filename);
      if (localPath) {
        res.set('Content-Type', mimeType);
        if (isManifest) {
          res.set('Cache-Control', 'no-cache, no-store');
        }
        const stream = fs.createReadStream(localPath);
        stream.pipe(res);
        return;
      }

      // 2. Check segment cache (not for manifests — PDR §6.3)
      if (!isManifest) {
        const cachedPath = await contentResolver.resolveCache(eventId, filename);
        if (cachedPath) {
          res.set('Content-Type', mimeType);
          const stream = fs.createReadStream(cachedPath);
          stream.pipe(res);
          return;
        }
      }

      // 3. Fetch from upstream
      if (upstreamProxy) {
        try {
          const cacheKey = `${eventId}/${filename}`;

          if (isManifest) {
            // Never cache live manifests
            const upstream = await upstreamProxy.fetch(eventId, filename);
            res.set('Content-Type', upstream.contentType);
            res.set('Cache-Control', 'no-cache, no-store');
            if (upstream.lastModified) res.set('Last-Modified', upstream.lastModified);
            if (upstream.etag) res.set('ETag', upstream.etag);

            // Check if VOD (has #EXT-X-ENDLIST) — cache VOD manifests
            const content = upstream.data.toString('utf-8');
            if (content.includes('#EXT-X-ENDLIST')) {
              res.set('Cache-Control', 'max-age=86400');
              // Cache VOD manifest
              await segmentCache.write(eventId, filename, upstream.data);
            }

            res.send(upstream.data);
            return;
          }

          // Segment: use inflight dedup
          const data = await inflightDedup.getOrFetch(cacheKey, async () => {
            const upstream = await upstreamProxy.fetch(eventId, filename);
            // Persist to cache
            await segmentCache.write(eventId, filename, upstream.data);
            return upstream.data;
          });

          res.set('Content-Type', mimeType);
          res.send(data);
          return;
        } catch {
          res.status(502).json({ error: 'Stream source unavailable' });
          return;
        }
      }

      res.status(404).json({ error: 'Not found' });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Support HEAD method
  router.head('/streams/:eventId/*', async (req: AuthenticatedRequest, res: Response) => {
    const eventId = req.params.eventId as string;
    const wildcardPath = req.params[0] as string | undefined;
    if (!wildcardPath) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const filename = path.basename(wildcardPath);
    const localPath = await contentResolver.resolveLocal(eventId, filename);
    if (localPath) {
      const ext = path.extname(filename).toLowerCase();
      const stat = fs.statSync(localPath);
      res.set({
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Last-Modified': stat.mtime.toUTCString(),
      });
      res.status(200).end();
      return;
    }

    res.status(404).end();
  });

  return router;
}
