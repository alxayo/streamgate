// =========================================================================
// POST /api/admin/login — Admin Login (Step 1 of 2)
// =========================================================================
// This is the first step of the admin authentication flow. It accepts an
// email and password, and returns one of several responses:
//
// 1. Legacy mode (no AdminUser records in DB):
//    - Compares password against ADMIN_PASSWORD_HASH env var
//    - Creates a legacy session (isLegacy=true, isAdmin=true)
//    - Returns { success: true, legacy: true }
//
// 2. Multi-user mode, 2FA enabled:
//    - Validates email + password against the database
//    - Returns { requires2FA: true, loginToken: "<JWT>" }
//    - The loginToken is a short-lived JWT (5 min) that the client passes
//      to /api/admin/verify-2fa in step 2
//
// 3. Multi-user mode, 2FA not yet set up:
//    - Validates email + password
//    - Creates a partial session (twoFactorVerified=false)
//    - Returns { success: true, requiresSetup2FA: true }
//    - Client redirects to /admin/setup-2fa
//
// Rate limited: 10 attempts per minute per IP address.
// All attempts (success/failure) are written to the audit log.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { SignJWT } from 'jose';
import { getSession } from '@/lib/admin-session';
import { RateLimiter } from '@/lib/rate-limiter';
import { RATE_LIMIT_ADMIN_LOGIN, LOGIN_TOKEN_EXPIRY_SECONDS } from '@streaming/shared';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { seedInitialAdmin } from '@/lib/admin-seed';

const loginLimiter = new RateLimiter(RATE_LIMIT_ADMIN_LOGIN);

export async function POST(request: NextRequest) {
  // Extract client IP for rate limiting and audit logging.
  // X-Forwarded-For is set by reverse proxies (Azure Container Apps, nginx).
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  // Rate limit: reject if too many login attempts from this IP
  const { allowed, retryAfterMs } = loginLimiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((retryAfterMs ?? 60000) / 1000)) },
      },
    );
  }

  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  // Seed the first Super Admin from env vars if no admin users exist.
  // This is a no-op after the first admin is created.
  await seedInitialAdmin();

  // Decide which auth mode to use: if AdminUser records exist, use multi-user;
  // otherwise fall back to the legacy ADMIN_PASSWORD_HASH env var.
  const adminCount = await prisma.adminUser.count();

  if (adminCount === 0) {
    // --- Legacy single-password mode ---
    let isValid: boolean;
    try {
      isValid = await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
    } catch {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (!isValid) {
      await logAttempt(null, 'login_failed', ip, { mode: 'legacy' });
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const session = await getSession();
    session.isAdmin = true;
    session.isLegacy = true;
    await session.save();

    await logAttempt(null, 'login', ip, { mode: 'legacy' });
    return NextResponse.json({ data: { success: true, legacy: true } });
  }

  // --- Multi-user mode: authenticate with email + password ---
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  // Look up user by email (case-insensitive, trimmed)
  const user = await prisma.adminUser.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  // Security: don't reveal whether the email exists in the system.
  // Return the same "Invalid credentials" message for unknown emails
  // and incorrect passwords.
  if (!user || !user.isActive) {
    await logAttempt(null, 'login_failed', ip, { email: email.toLowerCase().trim() });
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    await logAttempt(user.id, 'login_failed', ip, {});
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // If TOTP is enabled, we DON'T create a session yet. Instead, we issue a
  // short-lived JWT (loginToken) that proves "password was correct". The client
  // sends this token along with the TOTP code to /api/admin/verify-2fa.
  // This is a two-step auth flow to prevent session creation before 2FA.
  if (user.totpEnabled) {
    const loginToken = await new SignJWT({ uid: user.id, purpose: '2fa' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${LOGIN_TOKEN_EXPIRY_SECONDS}s`)
      .sign(new TextEncoder().encode(env.ADMIN_SESSION_SECRET));

    return NextResponse.json({
      data: { requires2FA: true, loginToken },
    });
  }

  // User hasn't set up 2FA yet — create a session but flag it as unverified.
  // The middleware will redirect them to /admin/setup-2fa.
  if (user.mustSetup2FA) {
    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    session.role = user.role as any;
    session.twoFactorVerified = false;
    await session.save();

    await prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await logAttempt(user.id, 'login', ip, { requires2FASetup: true });
    return NextResponse.json({
      data: { success: true, requiresSetup2FA: true },
    });
  }

  // Edge case: 2FA not configured and not required. This shouldn't happen for
  // newly created admins (they all have mustSetup2FA=true), but handle it
  // gracefully by creating a full session.
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

  await logAttempt(user.id, 'login', ip, {});
  return NextResponse.json({ data: { success: true } });
}

/**
 * Write a login attempt to the audit log.
 * Wrapped in try/catch so a database error in logging doesn't break the login flow.
 */
async function logAttempt(
  userId: string | null,
  action: string,
  ipAddress: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        details: JSON.stringify(details),
        ipAddress,
      },
    });
  } catch {
    // Don't fail login if audit logging fails
  }
}

