import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
import { normalizeIpOrCidr } from '@/lib/rtmp-play-ip-access';

// GET lists the RTMP PLAY IP rules for one event so the admin UI can render them.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkPermission('events:view');
  if (denied) return denied;

  const { id: eventId } = await params;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  // Newest entries appear first, which matches how admins expect recent edits to show up.
  const entries = await prisma.rtmpPlayAllowlistEntry.findMany({
    where: { eventId },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ data: entries });
}

// POST creates one allow-list rule. The input can be a single IP or a CIDR range.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkPermission('events:edit');
  if (denied) return denied;

  const { id: eventId } = await params;
  const body = await request.json().catch(() => null) as { cidr?: unknown; label?: unknown } | null;
  if (!body || typeof body.cidr !== 'string') {
    return NextResponse.json({ error: 'IP address or CIDR is required' }, { status: 400 });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  let cidr: string;
  try {
    // Normalize before saving so duplicates like 203.0.113.10 and 203.0.113.10/32 collide.
    cidr = normalizeIpOrCidr(body.cidr);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid IP address or CIDR' }, { status: 400 });
  }

  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : null;

  try {
    const entry = await prisma.rtmpPlayAllowlistEntry.create({
      data: { eventId, cidr, label },
    });
    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: 'This IP range is already allowed for this event' }, { status: 409 });
    }
    console.error(`Failed to create RTMP PLAY allow-list entry for event ${eventId}:`, error);
    return NextResponse.json({ error: 'Failed to add IP range' }, { status: 500 });
  }
}

// Prisma uses code P2002 for unique constraint failures.
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}