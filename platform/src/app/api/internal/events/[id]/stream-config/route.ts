/**
 * Internal API: Per-Event Stream Config
 * ======================================
 * GET /api/internal/events/:id/stream-config
 *
 * Called by the HLS Transcoder (Go service) on every publish_start event.
 * Returns the merged stream configuration for a specific event:
 *   system defaults + per-event overrides = effective config
 *
 * Auth: X-Internal-Api-Key header (same shared secret as the revocation endpoint).
 * Uses env.INTERNAL_API_KEY (typed, throws on missing) — NOT process.env directly.
 *
 * Response codes:
 *   200 — config returned (transcoder should start FFmpeg)
 *   401 — invalid/missing API key
 *   404 — event not found or inactive (transcoder must NOT start FFmpeg)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { getSystemDefaults, mergeStreamConfig } from '@/lib/stream-config';
import type { TranscoderConfig, PlayerConfig } from '@streaming/shared';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Authenticate — reject requests without a valid internal API key
  const apiKey = request.headers.get('x-internal-api-key');
  if (apiKey !== env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Fetch by UUID first, then fall back to rtmpStreamKeyHash lookup.
  // The HLS transcoder extracts the last path segment from the RTMP stream key
  // (e.g., "creatortwo-4979c4514ce1" from "live/creatortwo-4979c4514ce1"),
  // which is the rtmpStreamKeyHash, not the UUID.
  const selectFields = {
    id: true,
    isActive: true,
    transcoderConfig: true,
    playerConfig: true,
    rtmpToken: true,
  };

  let event = await prisma.event.findUnique({
    where: { id },
    select: selectFields,
  });

  if (!event) {
    event = await prisma.event.findUnique({
      where: { rtmpStreamKeyHash: id },
      select: selectFields,
    });
  }

  // If event doesn't exist or is deactivated, return 404.
  // The transcoder's failure policy (§0.2) says: 404 → do not start FFmpeg.
  if (!event || !event.isActive) {
    return NextResponse.json({ error: 'Event not found or inactive' }, { status: 404 });
  }

  // Get the system-wide defaults (with bootstrap guard — never throws)
  const systemDefaults = await getSystemDefaults();

  // Parse the event's JSON override fields (stored as strings in SQLite)
  const eventOverrides = {
    transcoder: event.transcoderConfig
      ? (JSON.parse(event.transcoderConfig) as Partial<TranscoderConfig>)
      : null,
    player: event.playerConfig
      ? (JSON.parse(event.playerConfig) as Partial<PlayerConfig>)
      : null,
  };

  // Merge: system defaults + event overrides = effective config
  const hasOverrides = event.transcoderConfig !== null || event.playerConfig !== null;
  const merged = mergeStreamConfig(systemDefaults, hasOverrides ? eventOverrides : null);

  return NextResponse.json({
    eventId: event.id,
    eventActive: true,
    configSource: hasOverrides ? 'event' : 'system-default',
    transcoder: merged.transcoder,
    player: merged.player,
    rtmpToken: event.rtmpToken ?? undefined,
  });
}
