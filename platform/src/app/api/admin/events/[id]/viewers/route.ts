import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

// GET /api/admin/events/:id/viewers — List active viewers with details
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const heartbeatCutoff = new Date(Date.now() - env.SESSION_TIMEOUT_SECONDS * 1000);

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, title: true, streamType: true },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const sessions = await prisma.activeSession.findMany({
    where: {
      lastHeartbeat: { gte: heartbeatCutoff },
      token: { eventId: id },
    },
    include: {
      token: {
        select: {
          code: true,
          label: true,
          redeemedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const viewers = sessions.map((session) => ({
    sessionId: session.sessionId,
    tokenCode: session.token.code,
    tokenLabel: session.token.label,
    clientIp: session.clientIp,
    userAgent: session.userAgent,
    lastHeartbeat: session.lastHeartbeat.toISOString(),
    sessionStarted: session.createdAt.toISOString(),
    redeemedAt: session.token.redeemedAt?.toISOString() ?? null,
  }));

  return NextResponse.json({
    data: {
      event,
      viewers,
      totalViewers: viewers.length,
    },
  });
}
