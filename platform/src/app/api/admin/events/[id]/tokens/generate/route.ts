import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateTokenCodes } from '@/lib/token-generator';
import { MAX_BATCH_TOKEN_COUNT } from '@streaming/shared';

// POST /api/admin/events/:id/tokens/generate — Generate tokens for an event
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const body = await request.json();
  const { count, label } = body as { count?: number; label?: string };

  if (!count || typeof count !== 'number' || count < 1 || count > MAX_BATCH_TOKEN_COUNT) {
    return NextResponse.json(
      { error: `Count must be between 1 and ${MAX_BATCH_TOKEN_COUNT}` },
      { status: 400 },
    );
  }

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
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
      // Check for unique constraint violation — retry with new codes
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
