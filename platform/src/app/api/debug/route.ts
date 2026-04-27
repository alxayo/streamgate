import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateRtmpToken, generateStreamKeyHash } from '@/lib/rtmp-tokens';

// Temporary debug endpoint — DELETE AFTER DEBUGGING
export async function GET(request: NextRequest) {
  const key = request.headers.get('x-debug-key');
  if (key !== 'rtmp-debug-2026') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const events = await prisma.event.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      title: true,
      rtmpToken: true,
      rtmpStreamKeyHash: true,
      rtmpTokenExpiresAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ events });
}

// POST: backfill RTMP tokens for all events missing them
export async function POST(request: NextRequest) {
  const key = request.headers.get('x-debug-key');
  if (key !== 'rtmp-debug-2026') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const events = await prisma.event.findMany({
    where: {
      OR: [{ rtmpToken: null }, { rtmpStreamKeyHash: null }],
    },
    select: { id: true, title: true, endsAt: true },
  });

  let updated = 0;
  for (const event of events) {
    const rtmpToken = generateRtmpToken(event.id, event.title);
    const rtmpStreamKeyHash = generateStreamKeyHash(event.id, event.title);
    await prisma.event.update({
      where: { id: event.id },
      data: { rtmpToken, rtmpStreamKeyHash, rtmpTokenExpiresAt: event.endsAt },
    });
    updated++;
  }

  return NextResponse.json({ updated, total: events.length });
}
