/**
 * Stream Configuration Types
 * ==========================
 * These types define how each live stream event is encoded (transcoder settings)
 * and how the viewer's player behaves (player settings).
 *
 * This file is the single source of truth for config shapes shared across:
 *   - Platform App (Next.js / TypeScript) — admin UI + API routes
 *   - HLS Media Server (Express / TypeScript) — only uses PlayerConfig indirectly
 *   - HLS Transcoder (Go) — has a matching Go struct in config_types.go
 *
 * The Go transcoder maintains its own struct definitions that mirror these types.
 * Both must stay in sync — the JSON schema contract (§0.1) is the authority.
 */

// ---------------------------------------------------------------------------
// Transcoder Config — controls how FFmpeg encodes the live stream
// ---------------------------------------------------------------------------

/**
 * H.264 codec-specific encoding options.
 * - tune: 'zerolatency' disables B-frames for lower latency (adds ~5% bitrate)
 *         'none' uses default encoder behavior
 * - preset: controls speed vs compression tradeoff
 *           'ultrafast' = fastest encode, worst compression, lowest CPU
 *           'veryfast'  = better quality, more CPU usage
 *
 * Note: These settings only affect *transcoded* renditions (e.g., 720p, 480p).
 * Copy/passthrough renditions (e.g., 1080p source) ignore these entirely.
 */
export interface H264Config {
  tune: 'zerolatency' | 'none';
  preset: 'ultrafast' | 'superfast' | 'veryfast';
}

/** AV1 codec options (future — not yet implemented) */
export interface AV1Config {
  preset: number;
  fastDecode: boolean;
}

/** VP9 codec options (future — not yet implemented) */
export interface VP9Config {
  deadline: 'realtime' | 'good';
  cpuUsed: number;
}

/** Supported video codec names. Only 'h264' is active today; others are future placeholders. */
export type CodecName = 'h264' | 'av1' | 'vp9';

/**
 * Render profile names — each maps to a fixed set of output renditions.
 * Admins pick a profile name; the transcoder looks up the rendition list.
 *
 * - 'passthrough-only': Single rendition, no transcoding (lowest CPU)
 * - 'low-latency-720p-480p': 2 transcoded renditions, no copy passthrough
 * - 'low-latency-1080p-720p-480p': 3 transcoded renditions (all re-encoded)
 * - 'full-abr-1080p-720p-480p': 1080p copy + 720p + 480p transcoded (default)
 */
export type RenderProfileName =
  | 'passthrough-only'
  | 'low-latency-720p-480p'
  | 'low-latency-1080p-720p-480p'
  | 'full-abr-1080p-720p-480p';

/**
 * Full transcoder configuration for an event.
 * Controls what the FFmpeg process does when a stream starts.
 */
export interface TranscoderConfig {
  /** Which video codecs to encode. Currently only ['h264'] is supported. */
  codecs: CodecName[];
  /** Which rendition profile to use — determines the ABR ladder shape. */
  profile: RenderProfileName;
  /** Duration of each HLS segment in seconds. Lower = less latency, more HTTP overhead. */
  hlsTime: number;
  /** Number of segments kept in the live playlist. 6 segments × 2s = 12s rewind window. */
  hlsListSize: number;
  /** Seconds between forced keyframes. Must be ≤ hlsTime for clean segment boundaries. */
  forceKeyFrameInterval: number;
  /** H.264-specific encoding settings (always present since H.264 is the primary codec). */
  h264: H264Config;
  /** AV1-specific settings (future — optional). */
  av1?: AV1Config;
  /** VP9-specific settings (future — optional). */
  vp9?: VP9Config;
}

// ---------------------------------------------------------------------------
// Player Config — controls how the viewer's hls.js player behaves
// ---------------------------------------------------------------------------

/**
 * Player configuration for an event.
 * These map directly to hls.js constructor options.
 * All settings are live-only — VOD playback ignores them.
 */
export interface PlayerConfig {
  /**
   * How many segments behind the live edge the player targets.
   * Lower values = closer to real-time but higher rebuffer risk.
   * Example: 2 with hlsTime=2 means the player is ~4s behind live.
   */
  liveSyncDurationCount: number;
  /**
   * Maximum segments behind live edge before the player forces a catch-up jump.
   * Should be ≥ 2× liveSyncDurationCount to avoid constant jumping.
   */
  liveMaxLatencyDurationCount: number;
  /**
   * Seconds of already-played content to keep in the browser's buffer.
   * - 0 = discard immediately (saves memory, no rewind)
   * - 30 = keep 30 seconds of rewind buffer
   * - -1 = keep everything (maps to Infinity in hls.js — unlimited rewind)
   */
  backBufferLength: number;
  /** Enable hls.js low-latency mode (aggressive live edge seeking). */
  lowLatencyMode: boolean;
}

// ---------------------------------------------------------------------------
// Render Profiles — maps profile names to their rendition lists
// ---------------------------------------------------------------------------

/**
 * A single video rendition (quality level) within a profile.
 * - mode 'copy': passthrough — no transcoding, uses source quality (lowest CPU)
 * - mode 'transcode': re-encodes video to the specified resolution/bitrate
 */
export interface Rendition {
  label: string;
  width: number;
  height: number;
  /** Video bitrate as FFmpeg string (e.g., '2500k') or 'copy' for passthrough */
  videoBitrate: string;
  /** Audio bitrate as FFmpeg string (e.g., '128k') or 'copy' for passthrough */
  audioBitrate: string;
  mode: 'copy' | 'transcode';
}

/**
 * The complete map of profile names to their rendition lists.
 * Both TypeScript (here) and Go (config_types.go) maintain this map.
 * The JSON schema contract is the source of truth for keeping them in sync.
 */
export const RENDER_PROFILES: Record<RenderProfileName, Rendition[]> = {
  // Single rendition — just copies the source stream to HLS, no transcoding.
  // Best for: minimal CPU usage, when source quality is already good.
  'passthrough-only': [
    { label: '1080p (source)', width: 1920, height: 1080, videoBitrate: 'copy', audioBitrate: 'copy', mode: 'copy' },
  ],

  // Two transcoded renditions — all re-encoded with forced keyframes.
  // Best for: low-latency with consistent segment boundaries.
  'low-latency-720p-480p': [
    { label: '720p', width: 1280, height: 720, videoBitrate: '2500k', audioBitrate: '128k', mode: 'transcode' },
    { label: '480p', width: 854, height: 480, videoBitrate: '1000k', audioBitrate: '96k', mode: 'transcode' },
  ],

  // Three transcoded renditions — all re-encoded (including 1080p).
  // Best for: when you need full keyframe control at all quality levels.
  'low-latency-1080p-720p-480p': [
    { label: '1080p', width: 1920, height: 1080, videoBitrate: '5000k', audioBitrate: '192k', mode: 'transcode' },
    { label: '720p', width: 1280, height: 720, videoBitrate: '2500k', audioBitrate: '128k', mode: 'transcode' },
    { label: '480p', width: 854, height: 480, videoBitrate: '1000k', audioBitrate: '96k', mode: 'transcode' },
  ],

  // Full ABR — 1080p is copied from source (saves CPU), lower tiers are transcoded.
  // Best for: balanced CPU usage with adaptive bitrate switching. This is the default.
  'full-abr-1080p-720p-480p': [
    { label: '1080p (source)', width: 1920, height: 1080, videoBitrate: 'copy', audioBitrate: 'copy', mode: 'copy' },
    { label: '720p', width: 1280, height: 720, videoBitrate: '2500k', audioBitrate: '128k', mode: 'transcode' },
    { label: '480p', width: 854, height: 480, videoBitrate: '1000k', audioBitrate: '96k', mode: 'transcode' },
  ],
};

// ---------------------------------------------------------------------------
// Default values — used when no admin overrides exist
// ---------------------------------------------------------------------------

/** System default transcoder settings — optimized for low-latency H.264 streaming. */
export const DEFAULT_TRANSCODER_CONFIG: TranscoderConfig = {
  codecs: ['h264'],
  profile: 'full-abr-1080p-720p-480p',
  hlsTime: 2,           // 2s segments for low latency (HTTP mode; SMB deployments should use 3)
  hlsListSize: 6,       // 6 × 2s = 12s playlist window
  forceKeyFrameInterval: 2, // Keyframe every 2s — matches segment duration for clean cuts
  h264: { tune: 'zerolatency', preset: 'ultrafast' },
};

/** System default player settings — optimized for low-latency live playback. */
export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  liveSyncDurationCount: 2,         // Target 2 segments behind live edge (~4s)
  liveMaxLatencyDurationCount: 4,   // Force catch-up if >4 segments behind (~8s)
  backBufferLength: 0,              // Don't keep played content (saves memory)
  lowLatencyMode: true,             // Enable hls.js low-latency optimizations
};

// ---------------------------------------------------------------------------
// API Response shapes — returned by internal endpoints to the transcoder
// ---------------------------------------------------------------------------

/** Response from GET /api/internal/events/:id/stream-config */
export interface StreamConfigResponse {
  eventId: string;
  eventActive: boolean;
  /** 'event' if the event has per-event overrides, 'system-default' if using global defaults */
  configSource: 'event' | 'system-default';
  transcoder: TranscoderConfig;
  player: PlayerConfig;
}

/** Response from GET /api/internal/stream-config/defaults */
export interface SystemDefaultsResponse {
  transcoder: TranscoderConfig;
  player: PlayerConfig;
}
