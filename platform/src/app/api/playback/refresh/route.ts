import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPlaybackToken, mintPlaybackToken } from '@/lib/jwt';
import { RateLimiter } from '@/lib/rate-limiter';
import { RATE_LIMIT_JWT_REFRESH } from '@streaming/shared';

const refreshLimiter = new RateLimiter(RATE_LIMIT_JWT_REFRESH);

export async function POST(request: NextRequest) {
  // Extract JWT from Authorization header
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Authorization required' }, { status: 401 });
  }

  const jwt = authHeader.slice(7);

  let claims;
  try {
    claims = await verifyPlaybackToken(jwt);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const code = claims.sub;
  const sessionId = claims.sid;

  // Rate limit: 12/hour per token code
  const { allowed, retryAfterMs } = refreshLimiter.check(code);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many refresh attempts' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((retryAfterMs ?? 60000) / 1000)) },
      },
    );
  }

  // Re-validate access code against DB (rules 1-4)
  const token = await prisma.token.findUnique({
    where: { code },
    include: { event: true },
  });

  if (!token) {
    return NextResponse.json({ error: 'Token no longer valid' }, { status: 401 });
  }

  if (!token.event.isActive) {
    return NextResponse.json({ error: 'This event is no longer available' }, { status: 403 });
  }

  if (token.isRevoked) {
    return NextResponse.json({ error: 'This code has been revoked' }, { status: 403 });
  }

  if (token.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This code has expired' }, { status: 410 });
  }

  // Verify session ID matches active session for this token
  const activeSession = await prisma.activeSession.findUnique({
    where: { sessionId },
  });

  if (!activeSession || activeSession.tokenId !== token.id) {
    return NextResponse.json({ error: 'Session no longer valid' }, { status: 401 });
  }

  // Issue new JWT with same session ID
  const { token: playbackToken, expiresIn } = await mintPlaybackToken(
    code,
    token.eventId,
    sessionId,
  );

  return NextResponse.json({
    playbackToken,
    tokenExpiresIn: expiresIn,
  });
}
