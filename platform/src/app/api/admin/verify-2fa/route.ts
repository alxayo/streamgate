// =========================================================================
// POST /api/admin/verify-2fa — TOTP Verification (Step 2 of 2)
// =========================================================================
// This is the second step of the login flow for users with 2FA enabled.
// The client sends:
//   - loginToken: the short-lived JWT from the login step (proves password was OK)
//   - code: the 6-digit TOTP code from the user's authenticator app
//
// Flow:
//   1. Validate the loginToken JWT (check signature, expiry, purpose="2fa")
//   2. Load the user and decrypt their TOTP secret from the database
//   3. Validate the TOTP code (with ±1 period tolerance for clock drift)
//   4. On success: create a full session with twoFactorVerified=true
//
// Rate limited: 5 attempts per 5 minutes per IP.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import * as OTPAuth from 'otpauth';
import { getSession } from '@/lib/admin-session';
import { RateLimiter } from '@/lib/rate-limiter';
import { RATE_LIMIT_2FA_VERIFY, TOTP_ISSUER, TOTP_DIGITS, TOTP_PERIOD, TOTP_WINDOW } from '@streaming/shared';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { decryptTotpSecret } from '@/lib/totp-crypto';

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
  const { loginToken, code } = body as { loginToken?: string; code?: string };

  if (!loginToken || !code) {
    return NextResponse.json({ error: 'Login token and code are required' }, { status: 400 });
  }

  // Validate the 6-digit format
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid code format' }, { status: 400 });
  }

  // --- Verify the loginToken JWT ---
  // This JWT was issued by the login endpoint after the password was verified.
  // It contains the user ID and has a "purpose" claim set to "2fa".
  let userId: string;
  try {
    const { payload } = await jwtVerify(
      loginToken,
      new TextEncoder().encode(env.ADMIN_SESSION_SECRET),
    );
    // Reject tokens issued for other purposes (defense in depth)
    if (payload.purpose !== '2fa' || !payload.uid) {
      return NextResponse.json({ error: 'Invalid login token' }, { status: 401 });
    }
    userId = payload.uid as string;
  } catch {
    return NextResponse.json({ error: 'Login token expired or invalid' }, { status: 401 });
  }

  // --- Decrypt the stored TOTP secret and validate the code ---
  // Load user and verify they still have 2FA enabled
  const user = await prisma.adminUser.findUnique({ where: { id: userId } });
  if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Decrypt the TOTP secret from the database (stored as AES-256-GCM encrypted)
  const secret = decryptTotpSecret(user.totpSecret, env.ADMIN_SESSION_SECRET);

  // Create a TOTP instance with the same parameters used during setup
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: user.email,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

  // validate() returns null if the code is invalid, or a delta number
  // indicating which time window matched (±1 for clock drift tolerance)
  const delta = totp.validate({ token: code, window: TOTP_WINDOW });
  if (delta === null) {
    await logAttempt(user.id, '2fa_failed', ip);
    return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 });
  }

  // --- 2FA verified successfully — create a full session ---
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

  await logAttempt(user.id, 'login', ip);
  return NextResponse.json({ data: { success: true } });
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
