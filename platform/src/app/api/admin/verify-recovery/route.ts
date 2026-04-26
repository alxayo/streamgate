// =========================================================================
// POST /api/admin/verify-recovery — Recovery Code Login (Alternative 2FA)
// =========================================================================
// When a user can't access their authenticator app, they can use a one-time
// recovery code instead. Each code can only be used once.
//
// The client sends:
//   - loginToken: the short-lived JWT from the login step
//   - recoveryCode: a code like "ABCDE-12345" (dashes/spaces are stripped)
//
// Flow:
//   1. Validate the loginToken JWT
//   2. Load all unused recovery codes for the user
//   3. Try bcrypt-comparing the input against each stored hash
//   4. On match: mark the code as used, create full session
//   5. Warn the user if they're running low on remaining codes
//
// Rate limited: 5 attempts per 5 minutes per IP.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import bcrypt from 'bcrypt';
import { getSession } from '@/lib/admin-session';
import { RateLimiter } from '@/lib/rate-limiter';
import { RATE_LIMIT_2FA_VERIFY } from '@streaming/shared';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';

const verifyLimiter = new RateLimiter(RATE_LIMIT_2FA_VERIFY);

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const { allowed, retryAfterMs } = verifyLimiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((retryAfterMs ?? 60000) / 1000)) },
      },
    );
  }

  const body = await request.json();
  const { loginToken, recoveryCode } = body as { loginToken?: string; recoveryCode?: string };

  if (!loginToken || !recoveryCode) {
    return NextResponse.json({ error: 'Login token and recovery code are required' }, { status: 400 });
  }

  // Normalize the recovery code: remove dashes and spaces, convert to
  // uppercase. This way "abcde-12345", "ABCDE 12345", and "ABCDE12345"
  // all match the same stored hash.
  const normalizedCode = recoveryCode.replace(/[-\s]/g, '').toUpperCase();

  // Verify loginToken JWT
  let userId: string;
  try {
    const { payload } = await jwtVerify(
      loginToken,
      new TextEncoder().encode(env.ADMIN_SESSION_SECRET),
    );
    if (payload.purpose !== '2fa' || !payload.uid) {
      return NextResponse.json({ error: 'Invalid login token' }, { status: 401 });
    }
    userId = payload.uid as string;
  } catch {
    return NextResponse.json({ error: 'Login token expired or invalid' }, { status: 401 });
  }

  // Load user
  const user = await prisma.adminUser.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Load all unused (usedAt is null) recovery codes for this user.
  // We need to bcrypt-compare against each one because bcrypt hashes are
  // salted — we can't look up the hash directly.
  const codes = await prisma.recoveryCode.findMany({
    where: { userId: user.id, usedAt: null },
  });

  // Try each stored code hash against the user's input.
  // bcrypt.compare is slow by design (security feature), so this loop
  // takes O(n) bcrypt operations. With 10 codes max, this is fine.
  let matchedCodeId: string | null = null;
  for (const code of codes) {
    const isMatch = await bcrypt.compare(normalizedCode, code.codeHash);
    if (isMatch) {
      matchedCodeId = code.id;
      break;
    }
  }

  if (!matchedCodeId) {
    await logAttempt(user.id, 'recovery_code_failed', ip);
    return NextResponse.json({ error: 'Invalid recovery code' }, { status: 401 });
  }

  // Mark the matched code as used (one-time-use enforcement)
  await prisma.recoveryCode.update({
    where: { id: matchedCodeId },
    data: { usedAt: new Date() },
  });

  // Count how many unused codes remain — warn the user if running low
  const remainingCodes = await prisma.recoveryCode.count({
    where: { userId: user.id, usedAt: null },
  });

  // Create a full session (same as successful TOTP verification)
  const session = await getSession();
  session.userId = user.id;
  session.email = user.email;
  session.role = user.role as any;
  session.twoFactorVerified = true;
  await session.save();

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await logAttempt(user.id, 'recovery_code_used', ip);

  return NextResponse.json({
    data: {
      success: true,
      remainingRecoveryCodes: remainingCodes,
      warning: remainingCodes <= 2
        ? `Only ${remainingCodes} recovery code(s) remaining. Generate new codes in settings.`
        : undefined,
    },
  });
}

async function logAttempt(userId: string, action: string, ipAddress: string): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { userId, action, ipAddress },
    });
  } catch {
    // Don't fail if audit logging fails
  }
}
