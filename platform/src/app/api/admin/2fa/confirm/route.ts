// =========================================================================
// POST /api/admin/2fa/confirm — Confirm 2FA Setup with Verification Code
// =========================================================================
// The final step of 2FA setup. The user enters the 6-digit code from their
// authenticator app to prove they've correctly saved the TOTP secret.
//
// On success, this endpoint:
//   1. Encrypts the TOTP secret with AES-256-GCM and saves it to the database
//   2. Generates 10 one-time-use recovery codes (bcrypt-hashed in DB)
//   3. Returns the plaintext recovery codes — shown to the user ONCE only
//   4. Updates the session to mark 2FA as verified
//
// Requires: authenticated session with a pending TOTP secret from /2fa/setup
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import * as OTPAuth from 'otpauth';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { getSession } from '@/lib/admin-session';
import { TOTP_ISSUER, TOTP_DIGITS, TOTP_PERIOD, TOTP_WINDOW, RECOVERY_CODE_COUNT } from '@streaming/shared';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { encryptTotpSecret } from '@/lib/totp-crypto';

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session.userId || !session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { code } = body as { code?: string };

  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Valid 6-digit code is required' }, { status: 400 });
  }

  // Retrieve the pending TOTP secret that was stored in the session
  // during the /2fa/setup step. If it's missing, the user skipped setup.
  const pendingSecret = (session as any)._pendingTotpSecret as string | undefined;
  if (!pendingSecret) {
    return NextResponse.json(
      { error: 'No pending 2FA setup. Start setup first.' },
      { status: 400 },
    );
  }

  // Verify the user's code against the pending secret to confirm they
  // have successfully added it to their authenticator app.
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: session.email,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(pendingSecret),
  });

  const delta = totp.validate({ token: code, window: TOTP_WINDOW });
  if (delta === null) {
    return NextResponse.json({ error: 'Invalid verification code' }, { status: 401 });
  }

  // Code verified! Now encrypt the TOTP secret for database storage.
  // The encryption key is derived from ADMIN_SESSION_SECRET (see totp-crypto.ts).
  const encryptedSecret = encryptTotpSecret(pendingSecret, env.ADMIN_SESSION_SECRET);

  // Generate one-time-use recovery codes as a backup for when the user
  // can't access their authenticator app. Each code is 10 hex characters.
  const recoveryCodes = generateRecoveryCodes(RECOVERY_CODE_COUNT);

  // Hash each recovery code with bcrypt so we never store plaintext.
  // Using 10 salt rounds (less than the 12 for passwords) since recovery
  // codes are already high-entropy random values.
  const hashedCodes = await Promise.all(
    recoveryCodes.map(async (code) => ({
      codeHash: await bcrypt.hash(code, 10),
    })),
  );

  // Save everything atomically in a database transaction.
  // If any step fails, none of the changes are committed.
  await prisma.$transaction(async (tx) => {
    // Enable 2FA on the user's account
    await tx.adminUser.update({
      where: { id: session.userId! },
      data: {
        totpSecret: encryptedSecret,
        totpEnabled: true,
        mustSetup2FA: false,
      },
    });

    // Remove any existing recovery codes (from a previous 2FA setup)
    await tx.recoveryCode.deleteMany({
      where: { userId: session.userId! },
    });

    // Store the bcrypt-hashed recovery codes
    await tx.recoveryCode.createMany({
      data: hashedCodes.map((c) => ({
        userId: session.userId!,
        codeHash: c.codeHash,
      })),
    });

    // Audit log
    await tx.auditLog.create({
      data: {
        userId: session.userId!,
        action: '2fa_setup',
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      },
    });
  });

  // Update the session: mark 2FA as verified and clean up the temporary secret
  session.twoFactorVerified = true;
  delete (session as any)._pendingTotpSecret; // No longer needed
  await session.save();

  // Return the plaintext recovery codes. These are shown to the user ONCE.
  // After this response, the plaintext is gone forever — only hashes remain in the DB.
  return NextResponse.json({
    data: {
      success: true,
      recoveryCodes: recoveryCodes.map(formatRecoveryCode),
    },
  });
}

/**
 * Generate N random recovery codes.
 * Each code is 10 hex characters (5 random bytes = 40 bits of entropy).
 * Formatted as XXXXX-XXXXX for readability when displayed to the user.
 */
function generateRecoveryCodes(count: number): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(5).toString('hex').toUpperCase());
  }
  return codes;
}

/**
 * Format recovery code for display: XXXXX-XXXXX
 */
function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}
