// =========================================================================
// Creator API: Event Actions — Convert to VOD / Purge Cache
// =========================================================================
// POST /api/creator/events/:id/actions
//
// Supports:
//   { action: "convert-vod" }   — Changes streamType to VOD and deactivates the live event
//   { action: "purge" }         — Deletes cached segments from HLS server
//
// Scoped to the creator's channel.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCreator } from '@/lib/creator-session';

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
      const apiKey = process.env.INTERNAL_API_KEY;

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

    default:
      return NextResponse.json(
        { error: 'Invalid action. Supported: convert-vod, purge' },
        { status: 400 },
      );
  }
}
