import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidAccessWindow, isValidEventSchedule } from '@streaming/shared';
import { env } from '@/lib/env';
import { validateTranscoderConfig, validatePlayerConfig } from '@/lib/stream-config';

// GET /api/admin/events — List all events with filters
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'active';
  const timeframe = searchParams.get('timeframe');
  const sort = searchParams.get('sort') || 'startDate';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  const where: Record<string, unknown> = {};
  const now = new Date();

  if (status === 'active') {
    where.isActive = true;
    where.isArchived = false;
  } else if (status === 'inactive') {
    where.isActive = false;
    where.isArchived = false;
  } else if (status === 'archived') {
    where.isArchived = true;
  }

  if (timeframe === 'upcoming') {
    where.startsAt = { gt: now };
  } else if (timeframe === 'past') {
    where.endsAt = { lt: now };
  }

  const orderBy: Record<string, string> =
    sort === 'title'
      ? { title: 'asc' }
      : sort === 'tokenCount'
        ? { title: 'asc' } // Will sort on application level
        : { startsAt: 'desc' };

  const heartbeatCutoff = new Date(Date.now() - env.SESSION_TIMEOUT_SECONDS * 1000);

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { tokens: true } },
        tokens: {
          select: {
            activeSessions: {
              where: { lastHeartbeat: { gte: heartbeatCutoff } },
              select: { id: true },
            },
          },
        },
      },
    }),
    prisma.event.count({ where }),
  ]);

  // Map events with active viewer counts
  const eventsWithViewers = events.map((event) => {
    const activeViewers = event.tokens.reduce(
      (sum, token) => sum + token.activeSessions.length,
      0,
    );
    const { tokens: _, ...rest } = event;
    return { ...rest, activeViewers };
  });

  return NextResponse.json({
    data: eventsWithViewers,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// POST /api/admin/events — Create a new event
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, description, streamType, streamUrl, posterUrl, startsAt, endsAt, accessWindowHours, autoPurge, transcoderConfig, playerConfig } = body;

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
    return NextResponse.json(
      { error: 'Access window must be 1-168 hours' },
      { status: 400 },
    );
  }

  if (streamUrl && typeof streamUrl === 'string') {
    try {
      new URL(streamUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid stream URL format' }, { status: 400 });
    }
  }

  const validStreamType = streamType === 'VOD' ? 'VOD' : 'LIVE';

  // Validate stream config overrides if provided
  if (transcoderConfig) {
    const result = validateTranscoderConfig(transcoderConfig);
    if (!result.valid) {
      return NextResponse.json({ error: 'Invalid transcoder config', details: result.errors }, { status: 400 });
    }
  }
  if (playerConfig) {
    const result = validatePlayerConfig(playerConfig);
    if (!result.valid) {
      return NextResponse.json({ error: 'Invalid player config', details: result.errors }, { status: 400 });
    }
  }

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
      autoPurge: typeof autoPurge === 'boolean' ? autoPurge : true,
      // Stream config: store as JSON string if provided, null means use system defaults
      transcoderConfig: transcoderConfig ? JSON.stringify(transcoderConfig) : null,
      playerConfig: playerConfig ? JSON.stringify(playerConfig) : null,
    },
  });

  return NextResponse.json({ data: event }, { status: 201 });
}
