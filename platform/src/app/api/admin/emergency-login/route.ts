// =========================================================================
// POST /api/admin/emergency-login — Emergency Recovery Access
// =========================================================================
// Last-resort login when all admin users are locked out of 2FA.
// Requires the EMERGENCY_RECOVERY_PASSWORD env var to be set (bcrypt hash).
//
// Security measures:
//   - Returns 404 if emergency login is not configured (don't reveal existence)
//   - Rate limited: 3 attempts per hour per IP (very strict)
//   - ALWAYS audit-logged (success AND failure), with console.error fallback
//     if the database write fails
//   - Creates a Super Admin session (userId="emergency")
//
// This endpoint should be used rarely and only in genuine emergencies.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { getSession } from '@/lib/admin-session';
import { RateLimiter } from '@/lib/rate-limiter';
import { RATE_LIMIT_EMERGENCY_LOGIN } from '@streaming/shared';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';

const emergencyLimiter = new RateLimiter(RATE_LIMIT_EMERGENCY_LOGIN);

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  // If emergency login is not configured, return 404 to avoid revealing
  // that this endpoint exists. Security by obscurity as an extra layer.
  const emergencyHash = env.EMERGENCY_RECOVERY_PASSWORD;
  if (!emergencyHash) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { allowed, retryAfterMs } = emergencyLimiter.check(ip);
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
  const { password } = body as { password?: string };

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  const isValid = await bcrypt.compare(password, emergencyHash);

  // ALWAYS audit-log emergency access attempts — this is a security-critical
  // operation and must be traceable. The logEmergencyAttempt function has a
  // console.error fallback if the database write fails.
  await logEmergencyAttempt(isValid ? 'emergency_login' : 'emergency_login_failed', ip);

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Create a Super Admin session with a synthetic user ID.
  // userId="emergency" is a special marker — it doesn't correspond to a real
  // AdminUser record. The session endpoint will display this appropriately.
  const session = await getSession();
  session.userId = 'emergency';
  session.email = 'emergency@system';
  session.role = 'SUPER_ADMIN';
  session.twoFactorVerified = true;
  await session.save();

  return NextResponse.json({ data: { success: true, emergency: true } });
}

/**
 * Log emergency access attempt to the audit log.
 * Has a console.error fallback because emergency access MUST be traceable
 * even if the database is having issues.
 */
async function logEmergencyAttempt(action: string, ipAddress: string): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: null,
        action,
        details: JSON.stringify({ type: 'emergency_access' }),
        ipAddress,
      },
    });
  } catch {
    // Log to console as fallback — emergency access must always be recorded
    console.error(`[SECURITY] Emergency login attempt (${action}) from ${ipAddress} — audit log write failed`);
  }
}
