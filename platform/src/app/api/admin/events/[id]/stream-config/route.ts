/**
 * Admin API: Event Stream Config + Ingest Endpoints
 * ===================================================
 * GET /api/admin/events/:id/stream-config
 *
 * Returns the effective (merged) stream config for an event plus
 * the RTMP/SRT ingest endpoint URLs with auth tokens.
 * Used by the event detail page to show "Stream Configuration" and
 * "Ingest Endpoints" cards.
 *
 * Protected by session cookie auth via Next.js middleware.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSystemDefaults, mergeStreamConfig } from '@/lib/stream-config';
import type { TranscoderConfig, PlayerConfig } from '@streaming/shared';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      streamType: true,
      isActive: true,
      transcoderConfig: true,
      playerConfig: true,
    },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // --- Effective stream config (merged system defaults + event overrides) ---
  const systemDefaults = await getSystemDefaults();

  const eventOverrides = {
    transcoder: event.transcoderConfig
      ? (JSON.parse(event.transcoderConfig) as Partial<TranscoderConfig>)
      : null,
    player: event.playerConfig
      ? (JSON.parse(event.playerConfig) as Partial<PlayerConfig>)
      : null,
  };

  const hasOverrides = event.transcoderConfig !== null || event.playerConfig !== null;
  const merged = mergeStreamConfig(systemDefaults, hasOverrides ? eventOverrides : null);

  // --- Ingest endpoints ---
  // The RTMP ingest URL uses the event ID as the stream key: live/{eventId}
  // The auth token is passed as a query parameter: ?token=XXX
  const rtmpHost = process.env.RTMP_SERVER_HOST
    || 'rtmp-server-du7fhxanu5cak.delightfulglacier-111baa9d.eastus2.azurecontainerapps.io';
  const rtmpPort = process.env.RTMP_SERVER_PORT || '1935';
  const rtmpToken = process.env.RTMP_AUTH_TOKEN || '';

  // Build the full RTMP ingest URL that OBS/FFmpeg would use
  const streamKey = `live/${event.id}`;
  const rtmpUrl = `rtmp://${rtmpHost}:${rtmpPort}/${streamKey}${rtmpToken ? `?token=${rtmpToken}` : ''}`;

  // SRT ingest (if configured — currently not deployed but show the format)
  const srtHost = process.env.SRT_SERVER_HOST || '';
  const srtPort = process.env.SRT_SERVER_PORT || '9000';
  const srtUrl = srtHost
    ? `srt://${srtHost}:${srtPort}?streamid=${streamKey}${rtmpToken ? `&passphrase=${rtmpToken}` : ''}`
    : null;

  return NextResponse.json({
    data: {
      // Which fields came from event overrides vs system defaults
      configSource: hasOverrides ? 'event' : 'system-default',

      // The merged effective config that the transcoder will use
      transcoder: merged.transcoder,
      player: merged.player,

      // Per-field override indicators for the UI badges
      overrides: {
        transcoder: event.transcoderConfig !== null,
        player: event.playerConfig !== null,
      },

      // Ingest endpoints for OBS/FFmpeg
      ingest: {
        rtmp: {
          url: rtmpUrl,
          // Split format for OBS (Server + Stream Key fields are separate)
          server: `rtmp://${rtmpHost}:${rtmpPort}`,
          streamKey: streamKey + (rtmpToken ? `?token=${rtmpToken}` : ''),
        },
        srt: srtUrl ? { url: srtUrl } : null,
        // Separate fields for easy display
        key: streamKey,
        token: rtmpToken || null,
      },
    },
  });
}
