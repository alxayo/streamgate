/**
 * VOD (Video-on-Demand) Configuration Types
 * ==========================================
 * These types define how uploaded videos are transcoded into HLS streams.
 * Unlike live streaming (which uses the TranscoderConfig from stream-config.ts),
 * VOD transcoding has different requirements:
 *
 *   - No need for 'zerolatency' — we can use better quality presets
 *   - Larger segments (4-6 seconds vs 2s for live) for better compression
 *   - All playlists include #EXT-X-ENDLIST (marks them as VOD, not live)
 *   - fMP4/CMAF container format (not MPEG-TS) for multi-codec HLS support
 *   - Multiple codecs can be produced in parallel (H.264, AV1, VP8, VP9)
 *
 * The admin configures system-wide defaults in the Admin Settings page.
 * Individual events can override these settings via the event's transcoderConfig.
 */

import type { CodecName } from './stream-config';

// ---------------------------------------------------------------------------
// VOD Rendition — a single output quality level for a specific codec
// ---------------------------------------------------------------------------

/**
 * Defines one output quality level (e.g., "1080p at 5000kbps").
 * Each codec can have its own rendition ladder — for example, AV1 might
 * use lower bitrates than H.264 for the same visual quality.
 *
 * Example:
 *   { label: '1080p', width: 1920, height: 1080, videoBitrate: '5000k', audioBitrate: '192k' }
 */
export interface VODRendition {
  /** Human-readable label shown in the admin UI (e.g., "1080p", "720p") */
  label: string;
  /** Output video width in pixels */
  width: number;
  /** Output video height in pixels */
  height: number;
  /** Video bitrate as an FFmpeg string (e.g., '5000k' = 5 Mbps) */
  videoBitrate: string;
  /** Audio bitrate as an FFmpeg string (e.g., '192k' = 192 kbps) */
  audioBitrate: string;
}

// ---------------------------------------------------------------------------
// Audio codec mapping — which audio codec pairs with which video codec
// ---------------------------------------------------------------------------

/** Supported audio codec names */
export type AudioCodecName = 'aac' | 'opus';

/**
 * Maps each video codec to its paired audio codec.
 * - H.264 uses AAC (universally supported, required by Apple HLS spec)
 * - AV1, VP8, VP9 use Opus (modern, better compression, open-source)
 */
export const CODEC_AUDIO_MAP: Record<CodecName, AudioCodecName> = {
  h264: 'aac',
  av1: 'opus',
  vp8: 'opus',
  vp9: 'opus',
};

// ---------------------------------------------------------------------------
// Container format mapping — MPEG-TS vs fMP4
// ---------------------------------------------------------------------------

/** Supported HLS segment container formats */
export type ContainerFormat = 'ts' | 'fmp4';

/**
 * Maps each video codec to its HLS segment container format.
 * - All VOD codecs use fMP4 (fragmented MP4 / CMAF) for maximum compatibility
 * - fMP4 supports modern codecs (AV1, VP9) that MPEG-TS cannot carry
 * - H.264 could use MPEG-TS but we use fMP4 for consistency in VOD mode
 *
 * Note: The live RTMP transcoder still uses MPEG-TS for H.264 (legacy compat).
 */
export const CODEC_CONTAINER_MAP: Record<CodecName, ContainerFormat> = {
  h264: 'fmp4',
  av1: 'fmp4',
  vp8: 'fmp4',
  vp9: 'fmp4',
};

// ---------------------------------------------------------------------------
// HLS codec strings — used in master.m3u8 CODECS attribute
// ---------------------------------------------------------------------------

/**
 * Maps each codec to the string used in HLS master playlist's CODECS attribute.
 * The player reads these to decide which variant it can decode.
 *
 * Format examples:
 *   #EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.640028,mp4a.40.2"
 *   #EXT-X-STREAM-INF:BANDWIDTH=4000000,CODECS="av01.0.08M.08,opus"
 */
export const CODEC_HLS_STRINGS: Record<CodecName, { video: Record<string, string>; audio: string }> = {
  h264: {
    video: {
      '1080p': 'avc1.640028',   // H.264 High Profile Level 4.0
      '720p': 'avc1.4d401f',    // H.264 Main Profile Level 3.1
      '480p': 'avc1.4d401e',    // H.264 Main Profile Level 3.0
      default: 'avc1.640028',
    },
    audio: 'mp4a.40.2',         // AAC-LC
  },
  av1: {
    video: {
      '1080p': 'av01.0.08M.08', // AV1 Main Profile, Level 4.0
      '720p': 'av01.0.05M.08',  // AV1 Main Profile, Level 3.1
      '480p': 'av01.0.04M.08',  // AV1 Main Profile, Level 3.0
      default: 'av01.0.08M.08',
    },
    audio: 'opus',
  },
  vp8: {
    video: {
      default: 'vp08.00.41.08',  // VP8
    },
    audio: 'opus',
  },
  vp9: {
    video: {
      '1080p': 'vp09.00.40.08', // VP9 Profile 0, Level 4.0
      '720p': 'vp09.00.31.08',  // VP9 Profile 0, Level 3.1
      '480p': 'vp09.00.30.08',  // VP9 Profile 0, Level 3.0
      default: 'vp09.00.40.08',
    },
    audio: 'opus',
  },
};

// ---------------------------------------------------------------------------
// Default VOD rendition ladders — used when no admin overrides exist
// ---------------------------------------------------------------------------

/**
 * Default rendition ladder for each codec.
 * These are the quality levels produced when an admin hasn't customized them.
 *
 * Notes:
 * - AV1 uses lower bitrates than H.264 for similar quality (better compression)
 * - VP8/VP9 bitrates are between H.264 and AV1
 * - All renditions assume the source video is at least 1080p
 * - If the source is lower resolution, the transcoder should skip larger renditions
 */
export const DEFAULT_VOD_RENDITIONS: Record<CodecName, VODRendition[]> = {
  h264: [
    { label: '1080p', width: 1920, height: 1080, videoBitrate: '5000k', audioBitrate: '192k' },
    { label: '720p', width: 1280, height: 720, videoBitrate: '2500k', audioBitrate: '128k' },
    { label: '480p', width: 854, height: 480, videoBitrate: '1000k', audioBitrate: '96k' },
  ],
  av1: [
    { label: '1080p', width: 1920, height: 1080, videoBitrate: '3000k', audioBitrate: '128k' },
    { label: '720p', width: 1280, height: 720, videoBitrate: '1500k', audioBitrate: '96k' },
    { label: '480p', width: 854, height: 480, videoBitrate: '600k', audioBitrate: '64k' },
  ],
  vp8: [
    { label: '1080p', width: 1920, height: 1080, videoBitrate: '4500k', audioBitrate: '128k' },
    { label: '720p', width: 1280, height: 720, videoBitrate: '2200k', audioBitrate: '96k' },
    { label: '480p', width: 854, height: 480, videoBitrate: '900k', audioBitrate: '64k' },
  ],
  vp9: [
    { label: '1080p', width: 1920, height: 1080, videoBitrate: '3500k', audioBitrate: '128k' },
    { label: '720p', width: 1280, height: 720, videoBitrate: '1800k', audioBitrate: '96k' },
    { label: '480p', width: 854, height: 480, videoBitrate: '700k', audioBitrate: '64k' },
  ],
};

// ---------------------------------------------------------------------------
// System defaults for VOD transcoding
// ---------------------------------------------------------------------------

/** Default HLS segment duration for VOD (seconds). Larger than live (2s) for better compression. */
export const DEFAULT_VOD_HLS_TIME = 4;

/** Default keyframe interval for VOD (seconds). Matches segment duration for clean cuts. */
export const DEFAULT_VOD_KEYFRAME_INTERVAL = 4;

/** Default max upload file size in bytes (5 GB) */
export const DEFAULT_MAX_UPLOAD_SIZE_BYTES = BigInt(5 * 1024 * 1024 * 1024); // 5368709120

/** Maximum allowed upload size that an admin can set (50 GB) */
export const MAX_ALLOWED_UPLOAD_SIZE_BYTES = BigInt(50 * 1024 * 1024 * 1024);

/** Minimum allowed upload size that an admin can set (100 MB) */
export const MIN_ALLOWED_UPLOAD_SIZE_BYTES = BigInt(100 * 1024 * 1024);

/** Allowed video MIME types for upload */
export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',           // .mp4 — most common
  'video/quicktime',     // .mov — Apple QuickTime
  'video/x-matroska',    // .mkv — Matroska container
  'video/webm',          // .webm — WebM container
  'video/x-msvideo',     // .avi — AVI container
] as const;

/** All supported codec names for validation */
export const ALL_CODEC_NAMES: CodecName[] = ['h264', 'av1', 'vp8', 'vp9'];
