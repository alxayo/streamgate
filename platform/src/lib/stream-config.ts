/**
 * Stream Config Utilities (Platform-side)
 * ========================================
 * Server-side utilities for managing stream configuration:
 *
 * 1. getSystemDefaults() — Fetches the global system settings from the DB.
 *    Uses an "upsert bootstrap guard" so it never fails on a missing row.
 *
 * 2. mergeStreamConfig() — Merges system defaults with per-event overrides.
 *    Called from 3 places: internal stream-config API, token validation, admin UI.
 *
 * 3. validateTranscoderConfig() / validatePlayerConfig() — Validates config
 *    objects from admin API requests (manual checks, no Zod dependency).
 *
 * This file lives in platform/src/lib/ (not shared/) because it depends on
 * Prisma and is only used server-side in the Next.js Platform App.
 */

import {
  type TranscoderConfig,
  type PlayerConfig,
  type RenderProfileName,
  type CodecName,
  DEFAULT_TRANSCODER_CONFIG,
  DEFAULT_PLAYER_CONFIG,
  RENDER_PROFILES,
} from '@streaming/shared';
import { prisma } from '@/lib/prisma';

// ---------------------------------------------------------------------------
// Hardcoded defaults — last-resort fallback when DB has no SystemSettings row
// ---------------------------------------------------------------------------

/**
 * These constants match the seed values in prisma/seed.ts.
 * They're used by the upsert bootstrap guard: if the SystemSettings table
 * is empty (fresh deploy, migration without seed), these values are inserted
 * automatically so the API never returns a 500.
 */
export const HARDCODED_TRANSCODER_DEFAULTS: TranscoderConfig = DEFAULT_TRANSCODER_CONFIG;
export const HARDCODED_PLAYER_DEFAULTS: PlayerConfig = DEFAULT_PLAYER_CONFIG;

// ---------------------------------------------------------------------------
// System defaults fetching with bootstrap guard
// ---------------------------------------------------------------------------

/**
 * Fetches the global system-wide stream config defaults from the database.
 *
 * Uses Prisma's `upsert` as a "bootstrap guard":
 * - If the SystemSettings row exists → returns it (the `update: {}` is a no-op)
 * - If the row doesn't exist → creates it with hardcoded defaults
 *
 * This means this function NEVER throws due to a missing row, even if
 * `npx prisma db seed` was not run after a migration.
 */
export async function getSystemDefaults(): Promise<{
  transcoder: TranscoderConfig;
  player: PlayerConfig;
}> {
  const settings = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      transcoderDefaults: JSON.stringify(HARDCODED_TRANSCODER_DEFAULTS),
      playerDefaults: JSON.stringify(HARDCODED_PLAYER_DEFAULTS),
    },
    update: {}, // No-op — don't overwrite existing settings
  });

  return {
    transcoder: JSON.parse(settings.transcoderDefaults) as TranscoderConfig,
    player: JSON.parse(settings.playerDefaults) as PlayerConfig,
  };
}

// ---------------------------------------------------------------------------
// Config merge utility
// ---------------------------------------------------------------------------

/**
 * Merges system-wide defaults with per-event overrides.
 *
 * Merge strategy (shallow spread per top-level key):
 * - Top-level scalar fields (hlsTime, profile, etc.) → event value wins
 * - Codec sub-objects (h264, av1, vp9) → shallow merge within each block
 * - Player fields → simple spread (no nesting)
 *
 * If eventOverrides is null (event has no custom config), returns system defaults.
 *
 * @param systemDefaults - Global defaults from SystemSettings table
 * @param eventOverrides - Per-event overrides from the Event's JSON fields (or null)
 * @returns The effective (merged) config to use for this event
 */
export function mergeStreamConfig(
  systemDefaults: { transcoder: TranscoderConfig; player: PlayerConfig },
  eventOverrides: {
    transcoder?: Partial<TranscoderConfig> | null;
    player?: Partial<PlayerConfig> | null;
  } | null,
): { transcoder: TranscoderConfig; player: PlayerConfig } {
  // No overrides? Just return defaults as-is.
  if (!eventOverrides) {
    return { ...systemDefaults };
  }

  // Merge transcoder config: spread top-level fields, then merge each codec sub-object
  const mergedTranscoder: TranscoderConfig = {
    ...systemDefaults.transcoder,
    ...(eventOverrides.transcoder ?? {}),
    // h264 is always present — merge its sub-fields individually
    h264: {
      ...systemDefaults.transcoder.h264,
      ...(eventOverrides.transcoder?.h264 ?? {}),
    },
    // av1/vp9 are optional — only include if either side has values
    ...(systemDefaults.transcoder.av1 || eventOverrides.transcoder?.av1
      ? {
          av1: {
            ...systemDefaults.transcoder.av1,
            ...(eventOverrides.transcoder?.av1 ?? {}),
          },
        }
      : {}),
    ...(systemDefaults.transcoder.vp9 || eventOverrides.transcoder?.vp9
      ? {
          vp9: {
            ...systemDefaults.transcoder.vp9,
            ...(eventOverrides.transcoder?.vp9 ?? {}),
          },
        }
      : {}),
  };

  // Merge player config: simple flat spread (no nested objects)
  const mergedPlayer: PlayerConfig = {
    ...systemDefaults.player,
    ...(eventOverrides.player ?? {}),
  };

  return { transcoder: mergedTranscoder, player: mergedPlayer };
}

// ---------------------------------------------------------------------------
// Validation utilities
// ---------------------------------------------------------------------------

/** All codec names the system recognizes (only h264 is active today). */
const VALID_CODECS: CodecName[] = ['h264', 'av1', 'vp9'];

/** All render profile names that map to known rendition lists. */
const VALID_PROFILES: RenderProfileName[] = Object.keys(RENDER_PROFILES) as RenderProfileName[];

/** Allowed values for h264.tune — 'zerolatency' or 'none'. */
const VALID_H264_TUNES = ['zerolatency', 'none'] as const;

/** Allowed values for h264.preset — encoding speed presets. */
const VALID_H264_PRESETS = ['ultrafast', 'superfast', 'veryfast'] as const;

/**
 * Validates a transcoder config object from an admin API request.
 *
 * Checks:
 * - No unknown top-level keys (defense against arbitrary JSON injection)
 * - Each known field has the correct type and is within allowed ranges
 * - Nested h264 sub-object is validated if present
 *
 * Fields are all optional because events can override just a subset
 * (e.g., only hlsTime without changing the profile).
 *
 * @param config - The raw config object from the request body
 * @returns { valid: boolean, errors: string[] } — errors array explains what's wrong
 */
export function validateTranscoderConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['transcoderConfig must be an object'] };
  }

  const c = config as Record<string, unknown>;

  // Reject any keys we don't recognize — prevents storing arbitrary data
  const allowedKeys = ['codecs', 'profile', 'hlsTime', 'hlsListSize', 'forceKeyFrameInterval', 'h264', 'av1', 'vp9'];
  for (const key of Object.keys(c)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`Unknown field: ${key}`);
    }
  }

  // codecs: must be a non-empty array of known codec names
  if (c.codecs !== undefined) {
    if (!Array.isArray(c.codecs) || c.codecs.length === 0) {
      errors.push('codecs must be a non-empty array');
    } else {
      for (const codec of c.codecs) {
        if (!VALID_CODECS.includes(codec as CodecName)) {
          errors.push(`Invalid codec: ${codec}`);
        }
      }
    }
  }

  // profile: must be one of the known render profile names
  if (c.profile !== undefined) {
    if (!VALID_PROFILES.includes(c.profile as RenderProfileName)) {
      errors.push(`Invalid profile: ${c.profile}`);
    }
  }

  // hlsTime: segment duration in seconds (1-10 range)
  if (c.hlsTime !== undefined) {
    if (typeof c.hlsTime !== 'number' || c.hlsTime < 1 || c.hlsTime > 10) {
      errors.push('hlsTime must be 1-10');
    }
  }

  // hlsListSize: number of segments in the live playlist (3-20 range)
  if (c.hlsListSize !== undefined) {
    if (typeof c.hlsListSize !== 'number' || c.hlsListSize < 3 || c.hlsListSize > 20) {
      errors.push('hlsListSize must be 3-20');
    }
  }

  // forceKeyFrameInterval: seconds between forced keyframes (1-10 range)
  if (c.forceKeyFrameInterval !== undefined) {
    if (typeof c.forceKeyFrameInterval !== 'number' || c.forceKeyFrameInterval < 1 || c.forceKeyFrameInterval > 10) {
      errors.push('forceKeyFrameInterval must be 1-10');
    }
  }

  // h264: codec-specific sub-object with tune and preset
  if (c.h264 !== undefined) {
    if (!c.h264 || typeof c.h264 !== 'object') {
      errors.push('h264 must be an object');
    } else {
      const h = c.h264 as Record<string, unknown>;
      if (h.tune !== undefined && !VALID_H264_TUNES.includes(h.tune as typeof VALID_H264_TUNES[number])) {
        errors.push(`Invalid h264.tune: ${h.tune}`);
      }
      if (h.preset !== undefined && !VALID_H264_PRESETS.includes(h.preset as typeof VALID_H264_PRESETS[number])) {
        errors.push(`Invalid h264.preset: ${h.preset}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a player config object from an admin API request.
 *
 * Checks:
 * - No unknown top-level keys
 * - Each field has the correct type and is within allowed ranges
 * - backBufferLength allows -1 (special value meaning Infinity in hls.js)
 *
 * @param config - The raw config object from the request body
 * @returns { valid: boolean, errors: string[] }
 */
export function validatePlayerConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['playerConfig must be an object'] };
  }

  const c = config as Record<string, unknown>;

  // Reject any keys we don't recognize
  const allowedKeys = ['liveSyncDurationCount', 'liveMaxLatencyDurationCount', 'backBufferLength', 'lowLatencyMode'];
  for (const key of Object.keys(c)) {
    if (!allowedKeys.includes(key)) {
      errors.push(`Unknown field: ${key}`);
    }
  }

  // liveSyncDurationCount: how many segments behind live edge to target (1-10)
  if (c.liveSyncDurationCount !== undefined) {
    if (typeof c.liveSyncDurationCount !== 'number' || c.liveSyncDurationCount < 1 || c.liveSyncDurationCount > 10) {
      errors.push('liveSyncDurationCount must be 1-10');
    }
  }

  // liveMaxLatencyDurationCount: max segments behind live before forced catch-up (2-20)
  if (c.liveMaxLatencyDurationCount !== undefined) {
    if (typeof c.liveMaxLatencyDurationCount !== 'number' || c.liveMaxLatencyDurationCount < 2 || c.liveMaxLatencyDurationCount > 20) {
      errors.push('liveMaxLatencyDurationCount must be 2-20');
    }
  }

  // backBufferLength: seconds of rewind buffer. -1 means Infinity (keep everything)
  if (c.backBufferLength !== undefined) {
    if (typeof c.backBufferLength !== 'number' || c.backBufferLength < -1) {
      errors.push('backBufferLength must be >= -1');
    }
  }

  // lowLatencyMode: boolean toggle for hls.js low-latency optimizations
  if (c.lowLatencyMode !== undefined) {
    if (typeof c.lowLatencyMode !== 'boolean') {
      errors.push('lowLatencyMode must be a boolean');
    }
  }

  return { valid: errors.length === 0, errors };
}
