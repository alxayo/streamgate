// =========================================================================
// POST /api/admin/2fa/reset — Reset Another User's 2FA (Super Admin Only)
// =========================================================================
// Allows a Super Admin to reset another user's two-factor authentication.
// This is used when a user has lost access to both their authenticator app
// AND all their recovery codes.
//
// What happens:
//   1. Clears the user's encrypted TOTP secret
//   2. Deletes all their recovery codes
//   3. Sets mustSetup2FA=true (they'll be prompted to set up 2FA on next login)
//   4. Writes an audit log entry recording who performed the reset
//
// Safety: admins cannot reset their own 2FA via this endpoint.
// Requires: 'users:manage' permission (Super Admin role)
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/admin-session';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';

export async function POST(request: NextRequest) {
  // Only Super Admin (users:manage permission) can reset other users' 2FA
  const denied = await checkPermission('users:manage');
  if (denied) return denied;

  const body = await request.json();
  const { userId } = body as { userId?: string };

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const session = await getSession();

  // Prevent admins from resetting their own 2FA through this endpoint.
  // Self-reset would bypass the "prove you can still authenticate" requirement.
  if (userId === session.userId) {
    return NextResponse.json(
      { error: 'Cannot reset your own 2FA via admin reset. Use the regenerate codes option.' },
      { status: 400 },
    );
  }

  const user = await prisma.adminUser.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Reset 2FA in a transaction: clear TOTP secret, delete recovery codes,
  // and require the user to set up 2FA again on their next login.
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: userId },
      data: {
        totpSecret: null,
        totpEnabled: false,
        mustSetup2FA: true,
      },
    });

    await tx.recoveryCode.deleteMany({
      where: { userId },
    });

    await tx.auditLog.create({
      data: {
        userId: session.userId ?? null,
        action: '2fa_reset',
        details: JSON.stringify({ targetUserId: userId, targetEmail: user.email }),
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      },
    });
  });

  return NextResponse.json({ data: { success: true } });
}
