// =========================================================================
// Creator API: Event Actions — Convert to VOD / Purge Cache / Rotate RTMP Token
// =========================================================================
// POST /api/creator/events/:id/actions
//
// Supports:
//   { action: "convert-vod" }        — Changes streamType to VOD and deactivates the live event
//   { action: "purge" }              — Deletes cached segments from HLS server
//   { action: "rotate-rtmp-token" }  — Generates a new RTMP token for the event
//
// Scoped to the creator's channel.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCreator } from '@/lib/creator-session';
import { generateRtmpToken } from '@/lib/rtmp-tokens';
import { getConfigValue, requireConfigValue, CONFIG_KEYS } from '@/lib/system-config';
import crypto from 'crypto';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const event = await prisma.event.findFirst({
    where: { id, channelId: session.channelId },
  });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const body = await request.json();
  const { action } = body as { action?: string };

  switch (action) {
    case 'convert-vod': {
      // Convert live stream to VOD — marks as inactive + changes type
      const updated = await prisma.event.update({
        where: { id },
        data: {
          streamType: 'VOD',
          isActive: false,
          isArchived: true,
        },
      });
      return NextResponse.json({ data: updated });
    }

    case 'purge': {
      // Delete cached HLS segments from the media server
      const hlsBaseUrl = process.env.HLS_SERVER_BASE_URL;
      const apiKey = await getConfigValue(prisma, CONFIG_KEYS.INTERNAL_API_KEY);

      if (!hlsBaseUrl || !apiKey) {
        return NextResponse.json(
          { error: 'HLS server not configured' },
          { status: 503 },
        );
      }

      try {
        const res = await fetch(`${hlsBaseUrl}/admin/cache/${id}`, {
          method: 'DELETE',
          headers: { 'X-Internal-Api-Key': apiKey },
          signal: AbortSignal.timeout(10000),
        });

        if (!res.ok && res.status !== 404) {
          return NextResponse.json(
            { error: 'Failed to purge cache' },
            { status: 502 },
          );
        }
      } catch {
        return NextResponse.json(
          { error: 'HLS server unreachable' },
          { status: 502 },
        );
      }

      return NextResponse.json({ success: true, message: 'Cache purged' });
    }

    case 'rotate-rtmp-token': {
      // Generate a new RTMP token for the event
      const signingSecret = await requireConfigValue(prisma, CONFIG_KEYS.PLAYBACK_SIGNING_SECRET);
      const newRtmpToken = generateRtmpToken(crypto.randomUUID(), event.title, signingSecret);
      
      const updated = await prisma.event.update({
        where: { id },
        data: {
          rtmpToken: newRtmpToken,
          rtmpTokenExpiresAt: event.endsAt,
        },
      });

      return NextResponse.json({
        data: {
          id: updated.id,
          rtmpToken: newRtmpToken, // Return the new token for admin display
          rtmpStreamKeyHash: updated.rtmpStreamKeyHash,
          rtmpTokenExpiresAt: updated.rtmpTokenExpiresAt,
          message: 'RTMP token rotated successfully. Save the new token — it won\'t be displayed again.',
        },
      });
    }

    default:
      return NextResponse.json(
        { error: 'Invalid action. Supported: convert-vod, purge' },
        { status: 400 },
      );
  }
}
