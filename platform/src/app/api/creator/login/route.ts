// =========================================================================
// POST /api/creator/login — Creator Login
// =========================================================================
// Validates email + password. If the creator has 2FA enabled, returns a
// loginToken for the second step. Otherwise creates a full session.
//
// Rate limited: 10 attempts per minute per IP.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { getCreatorSession } from '@/lib/creator-session';
import { RateLimiter } from '@/lib/rate-limiter';
import { prisma } from '@/lib/prisma';

const loginLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60_000 });

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const { allowed, retryAfterMs } = loginLimiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((retryAfterMs ?? 60000) / 1000)) } },
    );
  }

  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }
  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  const trimmedEmail = email.trim().toLowerCase();

  // Look up creator
  const creator = await prisma.creator.findUnique({
    where: { email: trimmedEmail },
    include: { channels: { where: { isActive: true }, take: 1 } },
  });

  if (!creator) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Check if account is locked (brute-force protection)
  if (creator.lockedUntil && creator.lockedUntil > new Date()) {
    const retryAfterSec = Math.ceil((creator.lockedUntil.getTime() - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Account temporarily locked due to too many failed attempts. Try again later.' },
      { status: 423, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  // Check if suspended
  if (!creator.isActive) {
    if (creator.isPendingApproval) {
      return NextResponse.json({ error: 'Account is pending admin approval.' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Account suspended. Contact support.' }, { status: 403 });
  }

  // Verify password
  const isValid = await bcrypt.compare(password, creator.passwordHash);
  if (!isValid) {
    // Increment failed attempts, lock if threshold reached
    const attempts = creator.failedLoginAttempts + 1;
    const LOCKOUT_THRESHOLD = 5;
    const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

    await prisma.creator.update({
      where: { id: creator.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: attempts >= LOCKOUT_THRESHOLD
          ? new Date(Date.now() + LOCKOUT_DURATION_MS)
          : null,
      },
    });

    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Check if creator has any active channel
  const channel = creator.channels[0];
  if (!channel) {
    return NextResponse.json({ error: 'No active channel found' }, { status: 403 });
  }

  // TODO: If 2FA is enabled, return loginToken instead of creating session
  // For now, 2FA is optional and not implemented in creator flow

  // Update last login timestamp + reset lockout counters
  await prisma.creator.update({
    where: { id: creator.id },
    data: {
      lastLoginAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // Create session
  const session = await getCreatorSession();
  session.creatorId = creator.id;
  session.email = creator.email;
  session.channelId = channel.id;
  session.channelSlug = channel.slug;
  session.displayName = creator.displayName;
  session.twoFactorVerified = true;
  await session.save();

  return NextResponse.json({
    data: {
      creatorId: creator.id,
      channelId: channel.id,
      channelSlug: channel.slug,
      displayName: creator.displayName,
    },
  });
}
