import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidRtmpToken, isValidStreamKeyHash } from '@/lib/rtmp-tokens';
import { getConfigValue, CONFIG_KEYS } from '@/lib/system-config';
import {
  evaluateRtmpPlayIpAccess,
  getRtmpPlayAllowlistMode,
  parseCidrList,
} from '@/lib/rtmp-play-ip-access';

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
  const expectedKey = await getConfigValue(prisma, CONFIG_KEYS.INTERNAL_API_KEY);

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
    clientIp?: string;
    remoteAddr?: string;
    // Legacy support: old endpoints using stream_name and RTMP_AUTH_TOKEN
    stream_name?: string;
    legacy_token?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { streamKeyHash, token, action, publisherIp, clientIp, remoteAddr } = body;

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

  if (action === 'play') {
    // RTMP PLAY has an extra IP policy layer. Publish auth intentionally remains unchanged.
    const mode = getRtmpPlayAllowlistMode();

    // Prefer the clearer new names, but keep publisherIp so older rtmp-go payloads still work.
    const remoteAddress = clientIp || remoteAddr || publisherIp || null;

    // Internal CIDRs come from deployment config because they describe the trusted Azure network.
    const internalCidrs = parseCidrList(process.env.RTMP_INTERNAL_PLAY_ALLOWED_CIDRS || '');

    // In off mode we skip the database query so the feature has no runtime policy cost.
    const entries = mode === 'off'
      ? []
      : await prisma.rtmpPlayAllowlistEntry.findMany({
        where: { eventId: event.id },
        select: { cidr: true },
      });

    const result = evaluateRtmpPlayIpAccess(
      remoteAddress,
      entries.map((entry) => entry.cidr),
      internalCidrs,
      mode,
    );

    if (mode === 'audit') {
      // Audit mode keeps playback open and records what enforce mode would do.
      console.info('[rtmp-play-ip-allowlist]', {
        decision: result.allowed ? 'would_allow' : 'would_deny',
        eventId: event.id,
        streamKeyHash,
        observedIp: result.clientIp,
        mode,
        reason: result.reason,
        matchedCidr: result.matchedCidr,
      });
    }

    if (mode === 'enforce' && !result.allowed) {
      // Keep the client-facing reason vague; detailed context stays in server logs.
      console.warn('[rtmp-play-ip-allowlist]', {
        decision: 'deny',
        eventId: event.id,
        streamKeyHash,
        observedIp: result.clientIp,
        mode,
        reason: result.reason,
      });
      return NextResponse.json(
        { authorized: false, reason: 'ip_not_allowed' },
        { status: 403 },
      );
    }
  }

  // For PUBLISH action: check single-publisher enforcement
  if (action === 'publish') {
    // Auto-expire stale sessions older than 12 hours (safety net for missed disconnects)
    const staleThreshold = new Date(Date.now() - 12 * 60 * 60 * 1000);
    await prisma.rtmpSession.updateMany({
      where: {
        eventId: event.id,
        endedAt: null,
        startedAt: { lt: staleThreshold },
      },
      data: {
        endedAt: staleThreshold,
        endedReason: 'stale_timeout',
      },
    });

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
          streamKey: streamKeyHash,
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
        const internalKey = await getConfigValue(prisma, CONFIG_KEYS.INTERNAL_API_KEY);
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
