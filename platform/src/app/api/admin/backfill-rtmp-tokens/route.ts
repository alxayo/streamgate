import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateRtmpToken, generateStreamKeyHash } from '@/lib/rtmp-tokens';

/**
 * POST /api/admin/backfill-rtmp-tokens
 * Generates RTMP tokens for all events that don't have them yet.
 * Admin-only endpoint (session cookie required via middleware).
 */
export async function POST(req: NextRequest) {
  const events = await prisma.event.findMany({
    where: {
      OR: [
        { rtmpToken: null },
        { rtmpStreamKeyHash: null },
      ],
    },
    select: { id: true, title: true, endsAt: true },
  });

  if (events.length === 0) {
    return NextResponse.json({ data: { updated: 0, message: 'All events already have RTMP tokens' } });
  }

  let updated = 0;
  for (const event of events) {
    const rtmpToken = generateRtmpToken(event.id, event.title);
    const rtmpStreamKeyHash = generateStreamKeyHash(event.id, event.title);

    await prisma.event.update({
      where: { id: event.id },
      data: {
        rtmpToken,
        rtmpStreamKeyHash,
        rtmpTokenExpiresAt: event.endsAt,
      },
    });
    updated++;
  }

  return NextResponse.json({
    data: {
      updated,
      total: events.length,
      message: `Generated RTMP tokens for ${updated} events`,
    },
  });
}
