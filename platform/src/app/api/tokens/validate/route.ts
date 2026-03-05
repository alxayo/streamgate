import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mintPlaybackToken } from '@/lib/jwt';
import { RateLimiter } from '@/lib/rate-limiter';
import { getActiveSession, createSession } from '@/lib/session-service';
import { getEventStatus } from '@/lib/stream-probe';
import { sanitizeTokenCode, RATE_LIMIT_TOKEN_VALIDATION } from '@streaming/shared';
import { env } from '@/lib/env';

const validateLimiter = new RateLimiter(RATE_LIMIT_TOKEN_VALIDATION);

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const userAgent = request.headers.get('user-agent') || undefined;

  // Rate limit: 5/min per IP
  const { allowed, retryAfterMs } = validateLimiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a moment and try again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((retryAfterMs ?? 60000) / 1000)) },
      },
    );
  }

  const body = await request.json();
  const code = sanitizeTokenCode(body.code);

  if (!code) {
    return NextResponse.json(
      { error: 'Invalid code. Please check your ticket and try again.' },
      { status: 401 },
    );
  }

  // Look up token with event
  const token = await prisma.token.findUnique({
    where: { code },
    include: { event: true },
  });

  // Rule 1: Code exists
  if (!token) {
    return NextResponse.json(
      { error: 'Invalid code. Please check your ticket and try again.' },
      { status: 401 },
    );
  }

  // Rule 3: Event is active
  if (!token.event.isActive) {
    return NextResponse.json(
      { error: 'This event is no longer available.' },
      { status: 403 },
    );
  }

  // Rule 2: Not revoked
  if (token.isRevoked) {
    return NextResponse.json(
      { error: 'This code has been revoked. Please contact the event organizer.' },
      { status: 403 },
    );
  }

  // Rule 4: Not expired
  const now = new Date();
  if (token.expiresAt < now) {
    return NextResponse.json(
      {
        error: `This code has expired. Access was available until ${token.expiresAt.toLocaleDateString()}.`,
      },
      { status: 410 },
    );
  }

  // Rule 5: No active session (single-device enforcement)
  const activeSession = await getActiveSession(token.id);
  if (activeSession) {
    return NextResponse.json(
      {
        error: 'This access code is currently in use on another device.',
        inUse: true,
      },
      { status: 409 },
    );
  }

  // Mark as redeemed if first use
  if (!token.redeemedAt) {
    await prisma.token.update({
      where: { id: token.id },
      data: { redeemedAt: now, redeemedIp: ip },
    });
  }

  // Create active session
  const sessionId = await createSession(token.id, ip, userAgent);

  // Mint JWT playback token
  const { token: playbackToken, expiresIn } = await mintPlaybackToken(
    token.code,
    token.eventId,
    sessionId,
  );

  // Determine live status
  const status = await getEventStatus(token.eventId, token.event.startsAt, token.event.endsAt);

  return NextResponse.json({
    event: {
      title: token.event.title,
      description: token.event.description,
      startsAt: token.event.startsAt.toISOString(),
      endsAt: token.event.endsAt.toISOString(),
      posterUrl: token.event.posterUrl,
      isLive: status === 'live',
    },
    playbackToken,
    playbackBaseUrl: env.HLS_SERVER_BASE_URL,
    streamPath: `/streams/${token.eventId}/stream.m3u8`,
    expiresAt: token.expiresAt.toISOString(),
    tokenExpiresIn: expiresIn,
  });
}
