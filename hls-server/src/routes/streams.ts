import { Router } from 'express';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../types.js';
import type { ContentResolver } from '../services/content-resolver.js';
import type { UpstreamProxy } from '../services/upstream-proxy.js';
import type { SegmentCache } from '../services/segment-cache.js';
import type { InflightDeduplicator } from '../services/inflight-dedup.js';
import type { ServerConfig } from '../config.js';

const MIME_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.fmp4': 'video/mp4',
  '.mp4': 'video/mp4',
};

const ALLOWED_EXTENSIONS = new Set(['.m3u8', '.ts', '.fmp4', '.mp4']);

// ABR rendition definitions matching the transcoder's output
const ABR_RENDITIONS = [
  { dir: 'stream_0', bandwidth: 5192000, resolution: '1920x1080' },
  { dir: 'stream_1', bandwidth: 2628000, resolution: '1280x720' },
  { dir: 'stream_2', bandwidth: 1096000, resolution: '854x480' },
];

/**
 * Generate a master.m3u8 dynamically by checking which variant stream
 * directories actually exist on disk. This provides a fallback when
 * the transcoder's master.m3u8 doesn't persist on Azure Files SMB.
 */
async function generateMasterPlaylist(
  streamRoot: string,
  streamKeyPrefix: string,
  eventId: string,
): Promise<string | null> {
  const eventDir = path.join(streamRoot, streamKeyPrefix + eventId);
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
  let found = 0;

  for (const r of ABR_RENDITIONS) {
    try {
      await fsPromises.access(path.join(eventDir, r.dir, 'index.m3u8'));
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.resolution}`);
      lines.push(`${r.dir}/index.m3u8`);
      found++;
    } catch {
      // Variant not available yet
    }
  }

  if (found === 0) return null;
  return lines.join('\n') + '\n';
}

/**
 * Generate a master.m3u8 dynamically by probing the upstream origin for
 * variant playlists. Used in proxy/blob-only mode where there is no local
 * filesystem to check.
 */
async function generateMasterPlaylistFromUpstream(
  upstreamProxy: UpstreamProxy,
  eventId: string,
): Promise<string | null> {
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
  let found = 0;

  const probes = ABR_RENDITIONS.map(async (r) => {
    try {
      await upstreamProxy.fetch(eventId, `${r.dir}/index.m3u8`);
      return r;
    } catch {
      return null;
    }
  });

  const results = await Promise.all(probes);
  for (const r of results) {
    if (r) {
      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.resolution}`);
      lines.push(`${r.dir}/index.m3u8`);
      found++;
    }
  }

  if (found === 0) return null;
  return lines.join('\n') + '\n';
}

export function createStreamRoutes(
  contentResolver: ContentResolver,
  upstreamProxy: UpstreamProxy | null,
  segmentCache: SegmentCache,
  inflightDedup: InflightDeduplicator,
  config: ServerConfig,
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

      // 1b. Dynamic master.m3u8 generation fallback — when the file doesn't
      // exist on Azure Files SMB (known persistence issue with os.WriteFile),
      // generate it from the variant directories that DO exist.
      if (filename === 'master.m3u8' && config.streamRoot) {
        const generated = await generateMasterPlaylist(config.streamRoot, config.streamKeyPrefix, eventId);
        if (generated) {
          console.log(`[dynamic-master] Generated master.m3u8 for event ${eventId} (local file missing)`);
          res.set('Content-Type', 'application/vnd.apple.mpegurl');
          res.set('Cache-Control', 'no-cache, no-store');
          res.send(generated);
          return;
        }
      }

      // 1c. Dynamic master.m3u8 from upstream — in proxy/blob-only mode,
      // probe the upstream for variant playlists and synthesize master.m3u8.
      if (filename === 'master.m3u8' && !config.streamRoot && upstreamProxy) {
        const generated = await generateMasterPlaylistFromUpstream(upstreamProxy, eventId);
        if (generated) {
          console.log(`[dynamic-master] Generated master.m3u8 for event ${eventId} from upstream (proxy mode)`);
          res.set('Content-Type', 'application/vnd.apple.mpegurl');
          res.set('Cache-Control', 'no-cache, no-store');
          res.send(generated);
          return;
        }
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
