// =========================================================================
// Creator Tokens API — GET (list) and POST (generate)
// =========================================================================
// GET: List tokens for a creator's event
// POST: Generate new tokens for the event
// Scoped to the creator's channel.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCreator } from '@/lib/creator-session';
import { generateTokenCodes } from '@/lib/token-generator';
import { MAX_BATCH_TOKEN_COUNT } from '@streaming/shared';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/creator/events/:id/tokens — List tokens for an event
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: eventId } = await params;

  // Verify event belongs to creator's channel
  const event = await prisma.event.findFirst({
    where: { id: eventId, channelId: session.channelId },
  });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const [tokens, total] = await Promise.all([
    prisma.token.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.token.count({ where: { eventId } }),
  ]);

  return NextResponse.json({
    data: tokens,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

// POST /api/creator/events/:id/tokens — Generate tokens
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: eventId } = await params;

  // Verify event belongs to creator's channel
  const event = await prisma.event.findFirst({
    where: { id: eventId, channelId: session.channelId },
  });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  const body = await request.json();
  const { count, label } = body as { count?: number; label?: string };

  if (!count || typeof count !== 'number' || count < 1 || count > MAX_BATCH_TOKEN_COUNT) {
    return NextResponse.json(
      { error: `Count must be between 1 and ${MAX_BATCH_TOKEN_COUNT}` },
      { status: 400 },
    );
  }

  // Compute token expiry: event.endsAt + event.accessWindowHours
  const expiresAt = new Date(
    event.endsAt.getTime() + event.accessWindowHours * 60 * 60 * 1000,
  );

  // Generate unique codes with collision retry
  let codes = generateTokenCodes(count);
  let retries = 0;
  const maxRetries = 3;

  while (retries < maxRetries) {
    try {
      const tokens = await prisma.$transaction(
        codes.map((code) =>
          prisma.token.create({
            data: {
              code,
              eventId,
              label: label || null,
              expiresAt,
            },
          }),
        ),
      );

      return NextResponse.json({ data: tokens }, { status: 201 });
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        codes = generateTokenCodes(count);
        retries++;
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json(
    { error: 'Failed to generate unique token codes after retries' },
    { status: 500 },
  );
}
