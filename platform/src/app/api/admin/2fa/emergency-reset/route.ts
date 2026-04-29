// =========================================================================
// POST /api/admin/2fa/emergency-reset — Emergency 2FA Reset (Password Auth)
// =========================================================================
// Temporary endpoint to reset 2FA when locked out. Authenticates using the
// ADMIN_PASSWORD_HASH env var (no session required). Resets totpEnabled,
// clears TOTP secret, deletes recovery codes, sets mustSetup2FA=true.
//
// REMOVE THIS ENDPOINT AFTER USE — it bypasses normal auth flow.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 });
  }

  // Verify against ADMIN_PASSWORD_HASH (proves caller is the admin)
  let valid: boolean;
  try {
    valid = await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
  } catch {
    return NextResponse.json({ error: 'Auth failed' }, { status: 401 });
  }
  if (!valid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const user = await prisma.adminUser.findFirst({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Reset 2FA
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabled: false, mustSetup2FA: true },
    });
    await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
  });

  return NextResponse.json({
    data: { success: true, message: `2FA reset for ${email}. Next login will prompt 2FA setup.` },
  });
}
