import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
import { getSession } from '@/lib/admin-session';

// POST /api/admin/events/:id/rtmp-session/reset
// Emergency DB-only unlock for stale RTMP publisher sessions.
//
// Important: this endpoint does not talk to rtmp-go and does not disconnect a
// real publisher. It only marks StreamGate's database session as ended so the
// next publish attempt is not blocked by an old missing publish_stop hook.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await checkPermission('events:edit');
  if (denied) return denied;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const confirmation = typeof body.confirmation === 'string' ? body.confirmation.trim() : '';

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, title: true },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (confirmation !== 'UNLOCK') {
    return NextResponse.json(
      { error: 'Confirmation required. Type UNLOCK to clear StreamGate RTMP session state.' },
      { status: 400 },
    );
  }

  const activeSessions = await prisma.rtmpSession.findMany({
    where: { eventId: event.id, endedAt: null },
    select: { id: true, connId: true, streamKey: true, startedAt: true, rtmpPublisherIp: true },
  });

  if (activeSessions.length === 0) {
    return NextResponse.json({
      data: {
        success: true,
        closedSessions: 0,
        message: 'No active RTMP session found.',
      },
    });
  }

  const session = await getSession();
  const endedAt = new Date();
  const endedBy = session.email || session.userId || (session.isLegacy ? 'legacy_admin' : 'admin');
  // Store the pre-reset session snapshot as JSON so support/debugging can later
  // answer: who unlocked it, when, and which publisher lock was cleared.
  const endedMetadata = JSON.stringify({
    resetAt: endedAt.toISOString(),
    eventId: event.id,
    eventTitle: event.title,
    activeSessions,
  });

  const updated = await prisma.rtmpSession.updateMany({
    where: { id: { in: activeSessions.map((activeSession) => activeSession.id) } },
    data: {
      endedAt,
      endedReason: 'manual_db_unlock',
      endedBy,
      endedMetadata,
    },
  });

  console.warn('RTMP session manually unlocked from StreamGate DB', {
    eventId: event.id,
    eventTitle: event.title,
    closedSessions: updated.count,
    endedBy,
    sessions: activeSessions,
  });

  return NextResponse.json({
    data: {
      success: true,
      closedSessions: updated.count,
      message: `Unlocked ${updated.count} active RTMP session(s).`,
    },
  });
}
