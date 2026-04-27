/**
 * RTMP Disconnect Webhook — POST /api/rtmp/disconnect
 * 
 * Called by rtmp-go when an RTMP stream ends.
 * Closes the active RtmpSession for the event.
 * 
 * Request body:
 *   { eventId: string }
 * 
 * Response (200 OK):
 *   { success: true, message: "Session closed" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  // Validate internal API key
  const apiKey = request.headers.get('X-Internal-Api-Key');
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401 },
    );
  }

  const body = await request.json();
  const { eventId } = body as { eventId?: string };

  if (!eventId || typeof eventId !== 'string') {
    return NextResponse.json(
      { error: 'Missing or invalid eventId' },
      { status: 400 },
    );
  }

  // Find and close active RTMP session for this event
  const activeSessions = await prisma.rtmpSession.findMany({
    where: {
      eventId,
      endedAt: null,
    },
  });

  if (activeSessions.length === 0) {
    return NextResponse.json(
      { success: true, message: 'No active session found' },
      { status: 200 },
    );
  }

  // Close all active sessions (should only be one, but handle multiple for safety)
  const updated = await prisma.rtmpSession.updateMany({
    where: {
      eventId,
      endedAt: null,
    },
    data: {
      endedAt: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    message: `Closed ${updated.count} session(s)`,
  });
}
