/**
 * Multi-Codec HLS Master Playlist Generator
 * ==========================================
 * Generates a master.m3u8 that references variant playlists from multiple
 * codecs (H.264, AV1, VP8, VP9). This is the top-level playlist that
 * the HLS player (hls.js) loads first.
 *
 * How HLS multi-codec works:
 *   1. The master.m3u8 lists all available quality/codec combinations
 *   2. Each entry has a CODECS attribute (e.g., "avc1.640028,mp4a.40.2")
 *   3. The player reads CODECS to pick a variant it can decode
 *   4. Modern browsers auto-select the best codec they support
 *
 * Example output:
 *   #EXTM3U
 *   #EXT-X-VERSION:7
 *   #EXT-X-STREAM-INF:BANDWIDTH=5192000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
 *   h264/stream_0/index.m3u8
 *   #EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,CODECS="av01.0.08M.08,opus"
 *   av1/stream_0/index.m3u8
 *
 * The master playlist is generated AFTER all codec transcoding jobs complete.
 * It is uploaded to Azure Blob at: {streamKeyPrefix}{eventId}/master.m3u8
 *
 * This file is called by the transcoder callback endpoint when the last
 * codec job reports success.
 */

import {
  type CodecName,
  type VODRendition,
  CODEC_HLS_STRINGS,
} from '@streaming/shared';

// ---------------------------------------------------------------------------
// Bitrate Parsing
// ---------------------------------------------------------------------------

/**
 * Parse an FFmpeg bitrate string (e.g., '5000k') into bits per second.
 *
 * FFmpeg uses shorthand suffixes for bitrates in its command-line options:
 *   - 'k' means kilobits (×1000), e.g., '5000k' → 5,000,000 bps = 5 Mbps
 *   - 'M' means megabits (×1,000,000), e.g., '2M' → 2,000,000 bps = 2 Mbps
 *   - No suffix means raw bits per second, e.g., '128000' → 128,000 bps
 *
 * We need this because VODRendition stores bitrates as FFmpeg strings
 * (e.g., '5000k'), but the HLS master playlist needs the BANDWIDTH attribute
 * as an integer in bits per second.
 *
 * @param bitrate - FFmpeg-style bitrate string (e.g., '5000k', '2M', '128000')
 * @returns Bits per second as a number
 */
export function parseBitrateString(bitrate: string): number {
  const trimmed = bitrate.trim();

  // Match a number (possibly decimal) followed by an optional suffix
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([kKmM]?)$/);
  if (!match) {
    return 0;
  }

  const value = parseFloat(match[1]);
  const suffix = match[2].toLowerCase();

  switch (suffix) {
    case 'k':
      // 'k' = kilobits → multiply by 1,000
      return Math.round(value * 1000);
    case 'm':
      // 'M' = megabits → multiply by 1,000,000
      return Math.round(value * 1_000_000);
    default:
      // No suffix → already in bits per second
      return Math.round(value);
  }
}

// ---------------------------------------------------------------------------
// Master Playlist Generator
// ---------------------------------------------------------------------------

/**
 * Generate a multi-codec HLS master playlist (master.m3u8).
 *
 * A master playlist (also called a "multivariant playlist" in the HLS spec)
 * is the entry point for HLS playback. It does NOT contain any media data
 * itself — instead, it lists all the available quality/codec variants, and
 * the player picks the best one it can play.
 *
 * Each variant is described by an #EXT-X-STREAM-INF tag with:
 *   - BANDWIDTH: total bits per second (video + audio) — the player uses
 *     this to pick a quality that fits the viewer's network speed
 *   - RESOLUTION: video dimensions (e.g., 1920x1080) — used for quality
 *     selection UI ("1080p", "720p")
 *   - CODECS: RFC 6381 codec strings (e.g., "avc1.640028,mp4a.40.2") —
 *     the player checks if the browser can decode these before selecting
 *
 * @param codecRenditions - Map of codec name → array of renditions that were transcoded.
 *   Example: { h264: [{label:'1080p',...}, {label:'720p',...}], av1: [{label:'1080p',...}] }
 *
 * @returns The master.m3u8 content as a string, ready to be uploaded to blob storage.
 *
 * Path convention: {codec}/stream_{index}/index.m3u8
 *   - stream_0 = highest quality (e.g., 1080p)
 *   - stream_1 = next lower (e.g., 720p)
 *   - etc.
 */
export function generateMasterPlaylist(
  codecRenditions: Record<string, VODRendition[]>,
): string {
  // #EXTM3U — required first line of every HLS playlist
  // #EXT-X-VERSION:7 — we use version 7 for fMP4/CMAF support (needed by AV1, VP9)
  const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:7'];

  // Iterate through each codec that was transcoded (e.g., h264, av1)
  for (const [codec, renditions] of Object.entries(codecRenditions)) {
    // Skip codecs with no renditions (shouldn't happen, but be defensive)
    if (!renditions || renditions.length === 0) {
      continue;
    }

    // Look up the HLS codec strings for this codec.
    // CODEC_HLS_STRINGS maps codec names to their RFC 6381 strings,
    // which browsers use to determine if they can decode the media.
    const hlsStrings = CODEC_HLS_STRINGS[codec as CodecName];

    for (let i = 0; i < renditions.length; i++) {
      const rendition = renditions[i];

      // Calculate total bandwidth (video + audio) in bits per second.
      // HLS spec says BANDWIDTH should represent the peak bitrate of the
      // variant stream, including all media (video + audio).
      const videoBps = parseBitrateString(rendition.videoBitrate);
      const audioBps = parseBitrateString(rendition.audioBitrate);
      const bandwidth = videoBps + audioBps;

      // Resolution string for the RESOLUTION attribute (e.g., "1920x1080")
      const resolution = `${rendition.width}x${rendition.height}`;

      // Look up the video codec string for this specific rendition label.
      // Some codecs have different profile/level strings per resolution
      // (e.g., H.264 uses High Profile for 1080p but Main Profile for 720p).
      // Fall back to 'default' if no label-specific string exists.
      let videoCodec: string;
      if (hlsStrings) {
        videoCodec =
          hlsStrings.video[rendition.label] ?? hlsStrings.video['default'] ?? 'unknown';
      } else {
        // Unknown codec — this shouldn't happen with known CodecName values,
        // but handle gracefully in case new codecs are added later
        videoCodec = 'unknown';
      }

      // Audio codec string (e.g., "mp4a.40.2" for AAC, "opus" for Opus)
      const audioCodec = hlsStrings?.audio ?? 'unknown';

      // Combine video + audio into the CODECS attribute value
      // e.g., "avc1.640028,mp4a.40.2" or "av01.0.08M.08,opus"
      const codecs = `${videoCodec},${audioCodec}`;

      // Add an empty line between codecs for readability (before each codec group)
      if (i === 0 && lines.length > 2) {
        lines.push('');
      }

      // #EXT-X-STREAM-INF describes one variant stream.
      // The line immediately after it MUST be the URI to that variant's playlist.
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},CODECS="${codecs}"`,
      );

      // Relative path to this variant's playlist file.
      // Convention: {codec}/stream_{index}/index.m3u8
      //   - stream_0 = highest quality rendition
      //   - stream_1 = next lower quality
      //   - etc.
      lines.push(`${codec}/stream_${i}/index.m3u8`);
    }
  }

  // HLS playlists must end with a newline
  return lines.join('\n') + '\n';
}
