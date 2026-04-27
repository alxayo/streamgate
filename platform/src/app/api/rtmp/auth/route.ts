import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidRtmpToken, isValidStreamKeyHash } from '@/lib/rtmp-tokens';

/**
 * POST /api/rtmp/auth — Webhook for rtmp-go RTMP server auth validation
 * 
 * Called by rtmp-go to validate RTMP publish/play requests using per-event tokens.
 * Requires X-Internal-Api-Key header for authentication.
 * 
 * Request body:
 *   { streamKeyHash: string, token: string, action: "publish" | "play", publisherIp: string }
 * 
 * Response (200 OK):
 *   { authorized: true, eventId, eventTitle, storagePath, rtmpTokenExpiresAt }
 * 
 * Response (403 Forbidden):
 *   { authorized: false, reason: string }
 */
export async function POST(request: NextRequest) {
  // Validate internal API key from header
  const apiKey = request.headers.get('X-Internal-Api-Key');
  const expectedKey = process.env.INTERNAL_API_KEY;

  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401 },
    );
  }

  let body: {
    streamKeyHash?: string;
    token?: string;
    action?: string;
    publisherIp?: string;
    // Legacy support: old endpoints using stream_name and RTMP_AUTH_TOKEN
    stream_name?: string;
    legacy_token?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { streamKeyHash, token, action, publisherIp } = body;

  // Validate inputs
  if (!streamKeyHash || typeof streamKeyHash !== 'string' || !isValidStreamKeyHash(streamKeyHash)) {
    return NextResponse.json(
      { authorized: false, reason: 'invalid_stream_key_hash' },
      { status: 403 },
    );
  }

  if (!token || typeof token !== 'string' || !isValidRtmpToken(token)) {
    return NextResponse.json(
      { authorized: false, reason: 'invalid_token' },
      { status: 403 },
    );
  }

  if (action !== 'publish' && action !== 'play') {
    return NextResponse.json(
      { authorized: false, reason: 'invalid_action' },
      { status: 403 },
    );
  }

  // Lookup event by streamKeyHash
  const event = await prisma.event.findUnique({
    where: { rtmpStreamKeyHash: streamKeyHash },
  });

  if (!event) {
    return NextResponse.json(
      { authorized: false, reason: 'stream_key_not_found' },
      { status: 403 },
    );
  }

  // Check if event is active
  if (!event.isActive) {
    return NextResponse.json(
      { authorized: false, reason: 'event_deactivated' },
      { status: 403 },
    );
  }

  // Check if event's channel (if exists) is active
  if (event.channelId) {
    const channel = await prisma.channel.findUnique({
      where: { id: event.channelId },
      select: { isActive: true },
    });
    if (!channel?.isActive) {
      return NextResponse.json(
        { authorized: false, reason: 'channel_deactivated' },
        { status: 403 },
      );
    }
  }

  // Verify RTMP token matches
  if (token !== event.rtmpToken) {
    return NextResponse.json(
      { authorized: false, reason: 'invalid_token' },
      { status: 403 },
    );
  }

  // Check token expiry
  const now = new Date();
  if (event.rtmpTokenExpiresAt && event.rtmpTokenExpiresAt < now) {
    return NextResponse.json(
      { authorized: false, reason: 'token_expired' },
      { status: 403 },
    );
  }

  // For PUBLISH action: check single-publisher enforcement
  if (action === 'publish') {
    const activeSessions = await prisma.rtmpSession.findMany({
      where: {
        eventId: event.id,
        endedAt: null,
      },
    });

    if (activeSessions.length > 0) {
      return NextResponse.json(
        { authorized: false, reason: 'already_streaming' },
        { status: 403 },
      );
    }

    // Create RTMP session to track active publisher
    try {
      await prisma.rtmpSession.create({
        data: {
          eventId: event.id,
          rtmpPublisherIp: publisherIp || 'unknown',
        },
      });
    } catch (error) {
      console.error(`Failed to create RTMP session for event ${event.id}:`, error);
      return NextResponse.json(
        { authorized: false, reason: 'internal_error' },
        { status: 500 },
      );
    }

    // Auto-purge stale segments before new stream starts
    if (event.autoPurge) {
      try {
        const hlsBaseUrl = process.env.HLS_SERVER_BASE_URL;
        const internalKey = process.env.INTERNAL_API_KEY;
        if (hlsBaseUrl && internalKey) {
          await fetch(`${hlsBaseUrl}/admin/cache/${event.id}`, {
            method: 'DELETE',
            headers: { 'X-Internal-Api-Key': internalKey },
            signal: AbortSignal.timeout(5000),
          });
        }
      } catch (error) {
        console.error(`Auto-purge failed for event ${event.id}:`, error);
      }
    }
  }

  // Authorization successful — return event metadata
  return NextResponse.json({
    authorized: true,
    eventId: event.id,
    eventTitle: event.title,
    storagePath: `/streams/${event.id}/`,
    rtmpTokenExpiresAt: event.rtmpTokenExpiresAt,
  }, { status: 200 });
}
