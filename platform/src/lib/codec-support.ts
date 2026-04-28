/**
 * Codec support utilities for the HLS player.
 *
 * Maps RFC 6381 codec strings (from the master.m3u8 CODECS attribute) to
 * human-readable labels so the quality selector can show "1080p (AV1)"
 * instead of duplicate "1080p" entries when multiple codecs are available.
 *
 * Note: hls.js v1.5+ handles codec capability detection and prioritization
 * internally — we do NOT need to call MediaSource.isTypeSupported() ourselves.
 * The master playlist ordering (AV1 → VP9 → H.264 → VP8) controls which
 * codec hls.js picks first.
 */

/**
 * Extracts a human-readable codec label from an RFC 6381 CODECS string.
 *
 * Examples:
 *   "av01.0.08M.08,opus"       → "AV1"
 *   "avc1.640028,mp4a.40.2"    → "H.264"
 *   "vp09.00.40.08,mp4a.40.2"  → "VP9"
 *   "vp08.00.41.08,opus"       → "VP8"
 *   undefined / empty           → null
 */
export function getCodecLabel(codecs: string | undefined): string | null {
  if (!codecs) return null;

  // The CODECS string may contain both video and audio codecs separated by
  // a comma (e.g., "av01.0.08M.08,opus"). We only need the video codec
  // prefix to determine the codec family.
  const videoCodec = codecs.split(',')[0]?.trim();
  if (!videoCodec) return null;

  if (videoCodec.startsWith('av01')) return 'AV1';
  if (videoCodec.startsWith('avc1') || videoCodec.startsWith('avc3')) return 'H.264';
  if (videoCodec.startsWith('hvc1') || videoCodec.startsWith('hev1')) return 'HEVC';
  if (videoCodec.startsWith('vp09')) return 'VP9';
  if (videoCodec.startsWith('vp08') || videoCodec.startsWith('vp8')) return 'VP8';

  return null;
}

/**
 * Checks whether a list of quality levels contains variants from multiple
 * different codecs. When true, the quality selector should show codec labels
 * (e.g., "1080p (AV1)") to disambiguate same-resolution entries.
 */
export function hasMultipleCodecs(
  levels: Array<{ codecs?: string }>,
): boolean {
  const seen = new Set<string>();
  for (const level of levels) {
    const label = getCodecLabel(level.codecs);
    if (label) seen.add(label);
    if (seen.size > 1) return true;
  }
  return false;
}
