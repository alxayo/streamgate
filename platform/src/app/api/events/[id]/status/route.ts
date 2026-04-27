import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getEventStatus } from '@/lib/stream-probe';
import { sanitizeTokenCode } from '@streaming/shared';

// GET /api/events/:id/status — Event status check (requires code query param)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await params;
  const { searchParams } = new URL(request.url);
  const code = sanitizeTokenCode(searchParams.get('code'));

  if (!code) {
    return NextResponse.json({ error: 'Valid access code is required' }, { status: 401 });
  }

  // Validate code belongs to event (lightweight check, no rate limit)
  const token = await prisma.token.findFirst({
    where: { code, eventId },
    include: { event: { include: { channel: { select: { name: true, slug: true, logoUrl: true } } } } },
  });

  if (!token) {
    return NextResponse.json({ error: 'Invalid access code or event' }, { status: 401 });
  }

  const status = await getEventStatus(eventId, token.event.startsAt, token.event.endsAt);

  return NextResponse.json({
    eventId,
    status,
    startsAt: token.event.startsAt.toISOString(),
    endsAt: token.event.endsAt.toISOString(),
    channel: token.event.channel ? {
      name: token.event.channel.name,
      slug: token.event.channel.slug,
      logoUrl: token.event.channel.logoUrl,
    } : null,
  });
}
