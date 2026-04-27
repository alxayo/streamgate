/**
 * Admin API: System Settings CRUD
 * ================================
 * GET  /api/admin/settings — Returns current system-wide defaults
 * PUT  /api/admin/settings — Updates system-wide defaults
 *
 * Protected by session cookie auth via Next.js middleware.
 * The middleware matcher ['/admin/:path*', '/api/admin/:path*'] covers this route.
 *
 * System settings are stored as a singleton row in the SystemSettings table.
 * The upsert bootstrap guard ensures the row always exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getSystemDefaults,
  validateTranscoderConfig,
  validatePlayerConfig,
} from '@/lib/stream-config';
import { checkPermission } from '@/lib/require-permission';
import { getRegistrationMode, type RegistrationMode } from '@/lib/registration-mode';
import {
  ALL_CODEC_NAMES,
  MIN_ALLOWED_UPLOAD_SIZE_BYTES,
  MAX_ALLOWED_UPLOAD_SIZE_BYTES,
} from '@streaming/shared';
import type { VODRendition } from '@streaming/shared';

/**
 * GET /api/admin/settings
 * Returns the current system-wide transcoder and player defaults.
 * Uses the bootstrap guard — always returns data, even if DB was never seeded.
 */
export async function GET() {
  const denied = await checkPermission('dashboard:view');
  if (denied) return denied;

  const defaults = await getSystemDefaults();
  const registrationMode = await getRegistrationMode();

  return NextResponse.json({
    data: {
      transcoder: defaults.transcoder,
      player: defaults.player,
      creatorRegistrationMode: registrationMode,
      // VOD settings — BigInt must be serialized as string for JSON
      maxUploadSizeBytes: defaults.maxUploadSizeBytes.toString(),
      enabledCodecs: defaults.enabledCodecs,
      vodRenditions: defaults.vodRenditions,
    },
  });
}

/**
 * PUT /api/admin/settings
 * Updates system-wide defaults. Accepts partial updates — you can update
 * just the transcoder config, just the player config, or both.
 *
 * Request body: { transcoder?: TranscoderConfig, player?: PlayerConfig }
 * Both fields are validated before saving. Invalid configs return 400.
 */
export async function PUT(request: NextRequest) {
  const denied = await checkPermission('settings:manage');
  if (denied) return denied;

  const body = await request.json();
  const { transcoder, player, creatorRegistrationMode, maxUploadSizeBytes, enabledCodecs, vodRenditions } = body;

  // Validate transcoder config if provided
  if (transcoder !== undefined) {
    const result = validateTranscoderConfig(transcoder);
    if (!result.valid) {
      return NextResponse.json(
        { error: 'Invalid transcoder config', details: result.errors },
        { status: 400 },
      );
    }
  }

  // Validate player config if provided
  if (player !== undefined) {
    const result = validatePlayerConfig(player);
    if (!result.valid) {
      return NextResponse.json(
        { error: 'Invalid player config', details: result.errors },
        { status: 400 },
      );
    }
  }

  // Validate registration mode if provided
  const validModes: RegistrationMode[] = ['open', 'approval', 'disabled'];
  if (creatorRegistrationMode !== undefined && !validModes.includes(creatorRegistrationMode)) {
    return NextResponse.json(
      { error: 'Invalid registration mode. Must be: open, approval, or disabled.' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // Validate VOD settings if provided
  // ---------------------------------------------------------------------------

  // maxUploadSizeBytes: must be a numeric string within the allowed range (100MB–50GB)
  if (maxUploadSizeBytes !== undefined) {
    const parsed = BigInt(maxUploadSizeBytes);
    if (parsed < MIN_ALLOWED_UPLOAD_SIZE_BYTES || parsed > MAX_ALLOWED_UPLOAD_SIZE_BYTES) {
      return NextResponse.json(
        { error: `maxUploadSizeBytes must be between ${MIN_ALLOWED_UPLOAD_SIZE_BYTES} and ${MAX_ALLOWED_UPLOAD_SIZE_BYTES}` },
        { status: 400 },
      );
    }
  }

  // enabledCodecs: must be a non-empty array of recognized codec names
  if (enabledCodecs !== undefined) {
    if (!Array.isArray(enabledCodecs) || enabledCodecs.length === 0) {
      return NextResponse.json(
        { error: 'enabledCodecs must be a non-empty array' },
        { status: 400 },
      );
    }
    for (const codec of enabledCodecs) {
      if (!ALL_CODEC_NAMES.includes(codec)) {
        return NextResponse.json(
          { error: `Invalid codec name: ${codec}` },
          { status: 400 },
        );
      }
    }
  }

  // vodRenditions: must be an object with valid codec keys and rendition arrays
  if (vodRenditions !== undefined) {
    if (!vodRenditions || typeof vodRenditions !== 'object' || Array.isArray(vodRenditions)) {
      return NextResponse.json(
        { error: 'vodRenditions must be an object' },
        { status: 400 },
      );
    }
    // Bitrate pattern: one or more digits followed by 'k' (e.g., '5000k', '128k')
    const bitratePattern = /^\d+k$/;
    for (const [codecKey, renditions] of Object.entries(vodRenditions)) {
      // Each key must be a recognized codec name
      if (!ALL_CODEC_NAMES.includes(codecKey as typeof ALL_CODEC_NAMES[number])) {
        return NextResponse.json(
          { error: `Invalid codec key in vodRenditions: ${codecKey}` },
          { status: 400 },
        );
      }
      // Each value must be a non-empty array of rendition objects
      if (!Array.isArray(renditions) || renditions.length === 0) {
        return NextResponse.json(
          { error: `vodRenditions.${codecKey} must be a non-empty array of renditions` },
          { status: 400 },
        );
      }
      // Validate each rendition object has the required fields with correct types
      for (const r of renditions as VODRendition[]) {
        if (!r.label || typeof r.label !== 'string') {
          return NextResponse.json(
            { error: `Each rendition in ${codecKey} must have a string 'label'` },
            { status: 400 },
          );
        }
        if (!Number.isInteger(r.width) || r.width <= 0 || !Number.isInteger(r.height) || r.height <= 0) {
          return NextResponse.json(
            { error: `Rendition "${r.label}" in ${codecKey}: width and height must be positive integers` },
            { status: 400 },
          );
        }
        if (typeof r.videoBitrate !== 'string' || !bitratePattern.test(r.videoBitrate)) {
          return NextResponse.json(
            { error: `Rendition "${r.label}" in ${codecKey}: videoBitrate must match pattern like '5000k'` },
            { status: 400 },
          );
        }
        if (typeof r.audioBitrate !== 'string' || !bitratePattern.test(r.audioBitrate)) {
          return NextResponse.json(
            { error: `Rendition "${r.label}" in ${codecKey}: audioBitrate must match pattern like '128k'` },
            { status: 400 },
          );
        }
      }
    }
  }

  // Get current values so we can merge partial updates
  const current = await getSystemDefaults();

  const updatedTranscoder = transcoder ?? current.transcoder;
  const updatedPlayer = player ?? current.player;

  // Upsert to handle both first-time creation and updates
  const settings = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      transcoderDefaults: JSON.stringify(updatedTranscoder),
      playerDefaults: JSON.stringify(updatedPlayer),
      ...(creatorRegistrationMode && { creatorRegistrationMode }),
      ...(maxUploadSizeBytes !== undefined && { maxUploadSizeBytes: BigInt(maxUploadSizeBytes) }),
      ...(enabledCodecs !== undefined && { enabledCodecs: JSON.stringify(enabledCodecs) }),
      ...(vodRenditions !== undefined && { vodRenditions: JSON.stringify(vodRenditions) }),
    },
    update: {
      transcoderDefaults: JSON.stringify(updatedTranscoder),
      playerDefaults: JSON.stringify(updatedPlayer),
      ...(creatorRegistrationMode && { creatorRegistrationMode }),
      ...(maxUploadSizeBytes !== undefined && { maxUploadSizeBytes: BigInt(maxUploadSizeBytes) }),
      ...(enabledCodecs !== undefined && { enabledCodecs: JSON.stringify(enabledCodecs) }),
      ...(vodRenditions !== undefined && { vodRenditions: JSON.stringify(vodRenditions) }),
    },
  });

  return NextResponse.json({
    data: {
      transcoder: JSON.parse(settings.transcoderDefaults),
      player: JSON.parse(settings.playerDefaults),
      creatorRegistrationMode: settings.creatorRegistrationMode,
      // VOD settings — BigInt serialized as string for JSON compatibility
      maxUploadSizeBytes: settings.maxUploadSizeBytes.toString(),
      enabledCodecs: JSON.parse(settings.enabledCodecs),
      vodRenditions: JSON.parse(settings.vodRenditions),
    },
  });
}
