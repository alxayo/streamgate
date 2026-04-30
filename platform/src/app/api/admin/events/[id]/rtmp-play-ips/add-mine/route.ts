import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getClientIp } from '@/lib/client-ip';
import { checkPermission } from '@/lib/require-permission';
import { normalizeIpOrCidr } from '@/lib/rtmp-play-ip-access';

// POST adds the current admin's browser IP to this event's RTMP PLAY allow-list.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkPermission('events:edit');
  if (denied) return denied;

  const { id: eventId } = await params;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  // This uses proxy headers because StreamGate usually sits behind Azure ingress.
  const clientIp = getClientIp(request);
  let cidr: string;
  try {
    // A single IP is stored as a host CIDR: /32 for IPv4 or /128 for IPv6.
    cidr = normalizeIpOrCidr(clientIp);
  } catch {
    return NextResponse.json({ error: 'Could not determine a valid client IP address' }, { status: 400 });
  }

  try {
    const entry = await prisma.rtmpPlayAllowlistEntry.create({
      data: { eventId, cidr, label: 'Current admin IP' },
    });
    return NextResponse.json({ data: entry }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await prisma.rtmpPlayAllowlistEntry.findUnique({
        where: { eventId_cidr: { eventId, cidr } },
      });
      return NextResponse.json({ data: existing, alreadyExists: true }, { status: 200 });
    }
    console.error(`Failed to add current IP to RTMP PLAY allow list for event ${eventId}:`, error);
    return NextResponse.json({ error: 'Failed to add current IP' }, { status: 500 });
  }
}

// Prisma uses code P2002 for unique constraint failures.
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}