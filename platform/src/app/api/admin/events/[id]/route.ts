import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidAccessWindow, isValidEventSchedule } from '@streaming/shared';
import { env } from '@/lib/env';

// GET /api/admin/events/:id — Get event details
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const heartbeatCutoff = new Date(Date.now() - env.SESSION_TIMEOUT_SECONDS * 1000);

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      _count: { select: { tokens: true } },
      tokens: {
        select: {
          isRevoked: true,
          redeemedAt: true,
          expiresAt: true,
          activeSessions: {
            where: { lastHeartbeat: { gte: heartbeatCutoff } },
            select: { id: true },
          },
        },
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const now = new Date();
  const tokenBreakdown = {
    unused: 0,
    redeemed: 0,
    expired: 0,
    revoked: 0,
  };

  for (const token of event.tokens) {
    if (token.isRevoked) {
      tokenBreakdown.revoked++;
    } else if (token.expiresAt < now) {
      tokenBreakdown.expired++;
    } else if (token.redeemedAt) {
      tokenBreakdown.redeemed++;
    } else {
      tokenBreakdown.unused++;
    }
  }

  const activeViewers = event.tokens.reduce(
    (sum, token) => sum + token.activeSessions.length,
    0,
  );

  const { tokens: _, ...eventData } = event;

  return NextResponse.json({
    data: { ...eventData, tokenBreakdown, activeViewers },
  });
}

// PUT /api/admin/events/:id — Update an event
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { title, description, streamType, streamUrl, posterUrl, startsAt, endsAt, accessWindowHours, autoPurge } = body;

  const existing = await prisma.event.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (title !== undefined && (!title || typeof title !== 'string' || title.trim().length === 0)) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const startDate = startsAt ? new Date(startsAt) : existing.startsAt;
  const endDate = endsAt ? new Date(endsAt) : existing.endsAt;

  if ((startsAt && isNaN(startDate.getTime())) || (endsAt && isNaN(endDate.getTime()))) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }

  if (!isValidEventSchedule(startDate, endDate)) {
    return NextResponse.json({ error: 'Start must be before end' }, { status: 400 });
  }

  const windowHours = accessWindowHours ?? existing.accessWindowHours;
  if (!isValidAccessWindow(windowHours)) {
    return NextResponse.json({ error: 'Access window must be 1-168 hours' }, { status: 400 });
  }

  if (streamUrl !== undefined && streamUrl !== null && streamUrl !== '') {
    try {
      new URL(streamUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid stream URL format' }, { status: 400 });
    }
  }

  const validStreamType = streamType === 'VOD' || streamType === 'LIVE' ? streamType : undefined;

  const event = await prisma.event.update({
    where: { id },
    data: {
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description || null }),
      ...(validStreamType !== undefined && { streamType: validStreamType }),
      ...(streamUrl !== undefined && { streamUrl: streamUrl || null }),
      ...(posterUrl !== undefined && { posterUrl: posterUrl || null }),
      ...(typeof autoPurge === 'boolean' && { autoPurge }),
      startsAt: startDate,
      endsAt: endDate,
      accessWindowHours: windowHours,
    },
  });

  return NextResponse.json({ data: event });
}

// DELETE /api/admin/events/:id — Permanently delete an event
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const confirmTitle = request.headers.get('x-confirm-delete');

  const event = await prisma.event.findUnique({
    where: { id },
    include: { _count: { select: { tokens: true } } },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (confirmTitle !== event.title) {
    return NextResponse.json(
      {
        error: `To confirm deletion, set X-Confirm-Delete header to the event title. This will permanently delete the event and ${event._count.tokens} associated tokens.`,
      },
      { status: 400 },
    );
  }

  await prisma.event.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
