// =========================================================================
// POST /api/admin/2fa/setup — Generate TOTP Secret + QR Code URI
// =========================================================================
// Called when a new admin needs to set up two-factor authentication.
// Generates a random TOTP secret and returns:
//   - otpauthUri: a URI that encodes into a QR code for authenticator apps
//   - secret: the base32 secret for manual entry
//
// The secret is stored temporarily in the session cookie (not yet in the DB).
// It's only saved to the database after the user proves they scanned it
// correctly by submitting a valid code to /api/admin/2fa/confirm.
//
// Requires: authenticated session (userId must exist)
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import * as OTPAuth from 'otpauth';
import { getSession } from '@/lib/admin-session';
import { TOTP_ISSUER, TOTP_DIGITS, TOTP_PERIOD } from '@streaming/shared';

export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session.userId || !session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Generate a cryptographically random 20-byte (160-bit) TOTP secret.
  // 20 bytes = 160 bits, which matches the SHA-1 hash output size (recommended).
  const secret = new OTPAuth.Secret({ size: 20 });

  // Create the TOTP instance — this generates the otpauth:// URI that
  // authenticator apps understand when scanned as a QR code.
  // Example URI: otpauth://totp/StreamGate:admin@example.com?secret=...&issuer=StreamGate
  const totp = new OTPAuth.TOTP({
    issuer: TOTP_ISSUER,
    label: session.email,
    algorithm: 'SHA1',
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret,
  });

  // Store the secret temporarily in the session cookie.
  // We use (session as any) because _pendingTotpSecret isn't in the
  // SessionData type — it's a transient field only used during 2FA setup.
  // The secret is only persisted to the DB after the user confirms setup.
  (session as any)._pendingTotpSecret = secret.base32;
  await session.save();

  return NextResponse.json({
    data: {
      otpauthUri: totp.toString(),
      secret: secret.base32, // For manual entry
    },
  });
}
