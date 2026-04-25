import { Router } from 'express';
import type { Request, Response } from 'express';
import type { UpstreamProxy } from '../services/upstream-proxy.js';
import type { ServerConfig } from '../config.js';
import { asyncHandler } from '../middleware/error-handler.js';

const ABR_RENDITIONS = [
  { dir: 'stream_0', bandwidth: 5192000, resolution: '1920x1080' },
  { dir: 'stream_1', bandwidth: 2628000, resolution: '1280x720' },
  { dir: 'stream_2', bandwidth: 1096000, resolution: '854x480' },
];

/**
 * Parse segment duration from a live playlist's EXTINF entries.
 * Returns a map of segment filename -> duration.
 */
function parsePlaylistSegments(playlistText: string): Array<{ duration: string; filename: string }> {
  const segments: Array<{ duration: string; filename: string }> = [];
  const lines = playlistText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith('#EXTINF:')) {
      const duration = line.replace('#EXTINF:', '').replace(',', '');
      const filename = lines[i + 1]?.trim();
      if (filename && !filename.startsWith('#')) {
        segments.push({ duration, filename });
      }
    }
  }
  return segments;
}

/**
 * Detect target duration from existing playlist or calculate from segment durations.
 */
function getTargetDuration(playlistText: string | null, segments: Array<{ duration: string }>): number {
  if (playlistText) {
    const match = playlistText.match(/#EXT-X-TARGETDURATION:(\d+)/);
    if (match) return parseInt(match[1]!, 10);
  }
  // Calculate from max segment duration, rounded up
  let max = 6;
  for (const seg of segments) {
    const d = Math.ceil(parseFloat(seg.duration));
    if (d > max) max = d;
  }
  return max;
}

/**
 * Build a complete VOD playlist with all segments and #EXT-X-ENDLIST.
 */
function buildVodPlaylist(targetDuration: number, segments: Array<{ duration: string; filename: string }>): string {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ];

  for (const seg of segments) {
    lines.push(`#EXTINF:${seg.duration},`);
    lines.push(seg.filename);
  }

  lines.push('#EXT-X-ENDLIST');
  lines.push('');
  return lines.join('\n');
}

export function createAdminFinalizeRoute(
  upstreamProxy: UpstreamProxy | null,
  config: ServerConfig,
) {
  const router = Router();

  router.post('/admin/finalize/:eventId', asyncHandler(async (req: Request, res: Response) => {
    const apiKey = req.headers['x-internal-api-key'];
    if (apiKey !== config.internalApiKey) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!upstreamProxy) {
      res.status(400).json({ error: 'No upstream proxy configured' });
      return;
    }

    const eventId = req.params.eventId as string;

    try {
      const variants: Array<{ dir: string; segmentCount: number }> = [];

      for (const rendition of ABR_RENDITIONS) {
        // List all blobs in this variant directory
        let blobs: string[];
        try {
          blobs = await upstreamProxy.listBlobs(eventId, rendition.dir);
        } catch {
          continue; // Variant doesn't exist, skip
        }

        // Filter to only .ts segment files and sort numerically
        const segmentBlobs = blobs
          .filter((name) => name.endsWith('.ts'))
          .sort((a, b) => {
            const numA = parseInt(a.match(/seg_(\d+)\.ts/)?.[1] || '0', 10);
            const numB = parseInt(b.match(/seg_(\d+)\.ts/)?.[1] || '0', 10);
            return numA - numB;
          });

        if (segmentBlobs.length === 0) continue;

        // Try to fetch existing variant playlist to get accurate durations
        let existingPlaylist: string | null = null;
        try {
          const playlistBlob = `${config.streamKeyPrefix}${eventId}/${rendition.dir}/index.m3u8`;
          const response = await upstreamProxy.fetch(eventId, `${rendition.dir}/index.m3u8`);
          if (typeof response === 'string') {
            existingPlaylist = response;
          } else if (Buffer.isBuffer(response)) {
            existingPlaylist = response.toString('utf-8');
          }
        } catch {
          // No existing playlist — we'll build from segment names with default durations
        }

        // If we have an existing playlist, use its EXTINF entries for accurate durations
        let segments: Array<{ duration: string; filename: string }>;
        if (existingPlaylist) {
          segments = parsePlaylistSegments(existingPlaylist);
          // Add any segments from blob listing that aren't in the playlist
          // (could happen if playlist didn't update before stream stopped)
          const playlistFilenames = new Set(segments.map((s) => s.filename));
          for (const blob of segmentBlobs) {
            const filename = blob.split('/').pop()!;
            if (!playlistFilenames.has(filename)) {
              segments.push({ duration: '6.000000', filename });
            }
          }
        } else {
          // No playlist — build from segment filenames with default duration
          segments = segmentBlobs.map((blob) => ({
            duration: '6.000000',
            filename: blob.split('/').pop()!,
          }));
        }

        const targetDuration = getTargetDuration(existingPlaylist, segments);
        const vodPlaylist = buildVodPlaylist(targetDuration, segments);

        // Upload the VOD playlist
        await upstreamProxy.putBlob(
          eventId,
          `${rendition.dir}/index.m3u8`,
          vodPlaylist,
          'application/vnd.apple.mpegurl',
        );

        variants.push({ dir: rendition.dir, segmentCount: segments.length });
      }

      if (variants.length === 0) {
        res.status(404).json({ error: 'No stream variants found for this event' });
        return;
      }

      // Build and upload master playlist
      const masterLines = ['#EXTM3U', '#EXT-X-VERSION:3'];
      for (const rendition of ABR_RENDITIONS) {
        const variant = variants.find((v) => v.dir === rendition.dir);
        if (variant) {
          masterLines.push(
            `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=${rendition.resolution}`,
          );
          masterLines.push(`${rendition.dir}/index.m3u8`);
        }
      }
      masterLines.push('');

      await upstreamProxy.putBlob(
        eventId,
        'master.m3u8',
        masterLines.join('\n'),
        'application/vnd.apple.mpegurl',
      );

      res.status(200).json({
        finalized: true,
        variants: variants.map((v) => ({ dir: v.dir, segments: v.segmentCount })),
      });
    } catch (error) {
      console.error(`Failed to finalize event ${eventId}:`, error);
      res.status(500).json({ error: 'Failed to finalize event as VOD' });
    }
  }));

  return router;
}
