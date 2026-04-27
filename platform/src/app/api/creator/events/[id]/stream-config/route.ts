// =========================================================================
// Creator API: Event Stream Config + Ingest Endpoints
// =========================================================================
// GET /api/creator/events/:id/stream-config
//
// Returns the RTMP/SRT ingest URLs for a creator's event.
// Scoped to the creator's channel — cannot access other channels' events.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCreator } from '@/lib/creator-session';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const event = await prisma.event.findFirst({
    where: { id, channelId: session.channelId },
    select: {
      id: true,
      title: true,
      streamType: true,
      isActive: true,
      rtmpToken: true,
      rtmpStreamKeyHash: true,
    },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // --- Ingest endpoints ---
  // Use per-event RTMP token and stream key hash if available, otherwise fall back to env var
  const rtmpHost = process.env.RTMP_SERVER_HOST
    || 'rtmp-server-du7fhxanu5cak.delightfulglacier-111baa9d.eastus2.azurecontainerapps.io';
  const rtmpPort = process.env.RTMP_SERVER_PORT || '1935';
  const rtmpToken = event.rtmpToken || process.env.RTMP_AUTH_TOKEN || '';

  // Use the slug-based stream key hash if available, otherwise fall back to UUID format
  const streamKey = event.rtmpStreamKeyHash
    ? `live/${event.rtmpStreamKeyHash}`
    : `live/${event.id}`;
  const rtmpUrl = `rtmp://${rtmpHost}:${rtmpPort}/${streamKey}${rtmpToken ? `?token=${rtmpToken}` : ''}`;

  // SRT ingest (if configured)
  const srtHost = process.env.SRT_SERVER_HOST || '';
  const srtPort = process.env.SRT_SERVER_PORT || '9000';
  const srtUrl = srtHost
    ? `srt://${srtHost}:${srtPort}?streamid=${streamKey}${rtmpToken ? `&passphrase=${rtmpToken}` : ''}`
    : null;

  return NextResponse.json({
    data: {
      ingest: {
        rtmp: {
          url: rtmpUrl,
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
