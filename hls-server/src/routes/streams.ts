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
import { CODEC_HLS_STRINGS } from '@streaming/shared';
import type { CodecName } from '@streaming/shared';

// .m4s files are fragmented MP4 (fMP4/CMAF) segments used by modern HLS.
// Multi-codec VOD transcoding (AV1, VP8, VP9) produces .m4s segments
// instead of .ts (MPEG-TS) because fMP4 supports these newer codecs.
// H.264 VOD also uses fMP4 for consistency across all codecs.
const MIME_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.fmp4': 'video/mp4',
  '.mp4': 'video/mp4',
  '.m4s': 'video/mp4',    // fMP4/CMAF segments (used by multi-codec VOD)
};

const ALLOWED_EXTENSIONS = new Set(['.m3u8', '.ts', '.fmp4', '.mp4', '.m4s']);

/**
 * Maps a resolution string (e.g., "1920x1080") to the label used in
 * CODEC_HLS_STRINGS (e.g., "1080p"). Falls back to "default" when
 * the resolution doesn't match a known label.
 */
function resolutionToLabel(resolution: string): string {
  const height = resolution.split('x')[1];
  switch (height) {
    case '1080': return '1080p';
    case '720': return '720p';
    case '480': return '480p';
    default: return 'default';
  }
}

// ABR rendition definitions matching the transcoder's output.
// Used for live streaming where there are no codec subdirectories.
const ABR_RENDITIONS = [
  { dir: 'stream_0', bandwidth: 5192000, resolution: '1920x1080' },
  { dir: 'stream_1', bandwidth: 2628000, resolution: '1280x720' },
  { dir: 'stream_2', bandwidth: 1096000, resolution: '854x480' },
];

// Codecs that VOD transcoding can produce. Each gets its own subdirectory
// under the event folder in blob storage (e.g., {eventId}/h264/stream_0/).
// ORDER MATTERS: hls.js picks the first compatible codec group at startup
// and stays with it. Placing the most efficient codecs first ensures the
// player uses AV1 (40% less bandwidth than H.264) when the device supports it.
const VOD_CODECS: CodecName[] = ['av1', 'vp9', 'h264', 'vp8'];

/**
 * Generate a master.m3u8 dynamically by checking which variant stream
 * directories actually exist on disk. This provides a fallback when
 * the transcoder's master.m3u8 doesn't persist on Azure Files SMB.
 *
 * Handles two directory structures:
 *   - Live streaming: {eventId}/stream_0/index.m3u8 (flat, no codec dirs)
 *   - VOD transcoded: {eventId}/{codec}/stream_0/playlist.m3u8 (nested under codec)
 */
async function generateMasterPlaylist(
  streamRoot: string,
  streamKeyPrefix: string,
  eventId: string,
): Promise<string | null> {
  const eventDir = path.join(streamRoot, streamKeyPrefix + eventId);
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:7'];
  let found = 0;

  // First, try multi-codec VOD structure: {eventId}/{codec}/stream_N/playlist.m3u8
  for (const codec of VOD_CODECS) {
    for (const r of ABR_RENDITIONS) {
      try {
        await fsPromises.access(path.join(eventDir, codec, r.dir, 'playlist.m3u8'));
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.resolution}`);
        lines.push(`${codec}/${r.dir}/playlist.m3u8`);
        found++;
      } catch {
        // Variant not available
      }
    }
  }

  // Fallback: try flat live streaming structure: {eventId}/stream_N/index.m3u8
  if (found === 0) {
    for (const r of ABR_RENDITIONS) {
      try {
        await fsPromises.access(path.join(eventDir, r.dir, 'index.m3u8'));
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.resolution}`);
        lines.push(`${r.dir}/index.m3u8`);
        found++;
      } catch {
        // Variant not available
      }
    }
  }

  if (found === 0) return null;
  return lines.join('\n') + '\n';
}

/**
 * Generate a master.m3u8 dynamically by probing the upstream origin (blob storage)
 * for variant playlists. Used in proxy/blob-only mode where there is no local
 * filesystem to check.
 *
 * Handles two directory structures:
 *   - Live streaming: {eventId}/stream_0/index.m3u8 (flat, no codec dirs)
 *   - VOD transcoded: {eventId}/{codec}/stream_0/playlist.m3u8 (nested under codec)
 *
 * Probes all codec/rendition combinations in parallel for speed — blob storage
 * returns 404 quickly for missing files, so parallel probing is efficient.
 */
async function generateMasterPlaylistFromUpstream(
  upstreamProxy: UpstreamProxy,
  eventId: string,
): Promise<string | null> {
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:7'];
  let found = 0;

  // First, try multi-codec VOD structure: {codec}/stream_N/playlist.m3u8
  // Build all probe requests in parallel for speed
  const vodProbes: Array<Promise<{ codec: string; rendition: typeof ABR_RENDITIONS[0] } | null>> = [];
  for (const codec of VOD_CODECS) {
    for (const r of ABR_RENDITIONS) {
      const probePath = `${codec}/${r.dir}/playlist.m3u8`;
      vodProbes.push(
        upstreamProxy.fetch(eventId, probePath)
          .then(() => {
            console.log(`[dynamic-master] Found variant: ${probePath}`);
            return { codec, rendition: r };
          })
          .catch((err: Error) => {
            // Debug: log first probe failure per codec to help diagnose SAS/path issues
            if (r.dir === 'stream_0') {
              console.log(`[dynamic-master] Probe miss: ${probePath} (${err.message})`);
            }
            return null;
          }),
      );
    }
  }

  const vodResults = (await Promise.all(vodProbes)).filter(Boolean) as Array<{ codec: string; rendition: typeof ABR_RENDITIONS[0] }>;
  console.log(`[dynamic-master] VOD probe found ${vodResults.length} variants for event ${eventId}`);

  // Group by codec to keep variants organized in the playlist.
  // hls.js reads the CODECS attribute to filter unsupported codecs and
  // locks onto the first compatible codec group (hence the ordering above).
  for (const codec of VOD_CODECS) {
    const codecVariants = vodResults.filter((v) => v.codec === codec);
    for (const v of codecVariants) {
      // Look up the RFC 6381 codec strings so hls.js knows what decoder is
      // needed. Without CODECS, hls.js can't distinguish H.264 from AV1 and
      // may pick a variant the browser can't decode.
      const hlsStrings = CODEC_HLS_STRINGS[v.codec as CodecName];
      const resolutionLabel = resolutionToLabel(v.rendition.resolution);
      const videoCodec = hlsStrings?.video[resolutionLabel] ?? hlsStrings?.video['default'] ?? 'unknown';
      const audioCodec = hlsStrings?.audio ?? 'mp4a.40.2';
      const codecsAttr = `${videoCodec},${audioCodec}`;

      lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${v.rendition.bandwidth},RESOLUTION=${v.rendition.resolution},CODECS="${codecsAttr}"`);
      lines.push(`${v.codec}/${v.rendition.dir}/playlist.m3u8`);
      found++;
    }
  }

  // Fallback: try flat live streaming structure: stream_N/index.m3u8
  if (found === 0) {
    const liveProbes = ABR_RENDITIONS.map(async (r) => {
      try {
        await upstreamProxy.fetch(eventId, `${r.dir}/index.m3u8`);
        return r;
      } catch {
        return null;
      }
    });

    const liveResults = await Promise.all(liveProbes);
    for (const r of liveResults) {
      if (r) {
        lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.resolution}`);
        lines.push(`${r.dir}/index.m3u8`);
        found++;
      }
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
      //
      // For multi-codec VOD uploads, the master.m3u8 is pre-generated by the
      // Platform App (see master-playlist-generator.ts) and stored in blob.
      // The upstream proxy will serve it directly — this dynamic fallback only
      // activates when the file doesn't exist (live streaming case).
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

      // 1c. Dynamic master.m3u8 from upstream — probe blob storage for variant
      // playlists and synthesize a master.m3u8. This handles both:
      //   - Proxy-only mode (no STREAM_ROOT set)
      //   - VOD content that lives only in blob (not on local filesystem)
      // We try this whenever upstream is available and we haven't found a master yet.
      if (filename === 'master.m3u8' && upstreamProxy) {
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

          // Segment: use inflight dedup with upstream retry for live race
          const data = await inflightDedup.getOrFetch(cacheKey, async () => {
            const upstream = await upstreamProxy.fetchWithRetry(eventId, filename);
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
