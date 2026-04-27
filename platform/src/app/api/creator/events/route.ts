// =========================================================================
// Creator Events API — GET (list) and POST (create)
// =========================================================================
// Scoped to the authenticated creator's active channel.
// =========================================================================

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidAccessWindow, isValidEventSchedule } from '@streaming/shared';
import { requireCreator } from '@/lib/creator-session';
import { generateRtmpToken, generateStreamKeyHash } from '@/lib/rtmp-tokens';

// GET /api/creator/events — List creator's events
export async function GET(request: NextRequest) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'active';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const where: Record<string, unknown> = { channelId: session.channelId };
  const now = new Date();

  if (status === 'active') {
    where.isActive = true;
  } else if (status === 'inactive') {
    where.isActive = false;
  } else if (status === 'upcoming') {
    where.isActive = true;
    where.startsAt = { gt: now };
  } else if (status === 'past') {
    where.isActive = true;
    where.endsAt = { lt: now };
  }

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy: { startsAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { _count: { select: { tokens: true } } },
    }),
    prisma.event.count({ where }),
  ]);

  return NextResponse.json({
    data: events,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// POST /api/creator/events — Create an event for the creator's channel
export async function POST(request: NextRequest) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { title, description, streamType, streamUrl, posterUrl, startsAt, endsAt, accessWindowHours } = body;

  // Validation
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  const startDate = new Date(startsAt);
  const endDate = new Date(endsAt);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }

  if (!isValidEventSchedule(startDate, endDate)) {
    return NextResponse.json({ error: 'Start must be before end' }, { status: 400 });
  }

  const windowHours = accessWindowHours ?? 48;
  if (!isValidAccessWindow(windowHours)) {
    return NextResponse.json({ error: 'Access window must be 1-168 hours' }, { status: 400 });
  }

  if (streamUrl && typeof streamUrl === 'string') {
    try {
      new URL(streamUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid stream URL format' }, { status: 400 });
    }
  }

  const validStreamType = streamType === 'VOD' ? 'VOD' : 'LIVE';

  // Generate RTMP tokens and stream key hash
  const rtmpToken = generateRtmpToken(crypto.randomUUID(), title);
  const rtmpStreamKeyHash = generateStreamKeyHash(crypto.randomUUID(), title);

  const event = await prisma.event.create({
    data: {
      title: title.trim(),
      description: description || null,
      streamType: validStreamType,
      streamUrl: streamUrl || null,
      posterUrl: posterUrl || null,
      startsAt: startDate,
      endsAt: endDate,
      accessWindowHours: windowHours,
      channelId: session.channelId!,
      rtmpToken,
      rtmpStreamKeyHash,
      rtmpTokenExpiresAt: endDate,
    },
  });

  return NextResponse.json({ data: event }, { status: 201 });
}
