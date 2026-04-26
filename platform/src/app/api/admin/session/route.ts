// =========================================================================
// GET /api/admin/session — Session Status Check
// =========================================================================
// Returns the current admin session state. Used by the frontend to:
//   - Check if the user is logged in (isAdmin flag)
//   - Get the user's role and permissions (for showing/hiding UI elements)
//   - Detect legacy mode (for showing the migration banner)
//   - Check 2FA verification status
//
// This endpoint is public (listed in middleware PUBLIC_PATHS) because the
// frontend needs to check session status before deciding to show the login form.
// =========================================================================

import { NextResponse } from 'next/server';
import { getSession, isAuthenticated } from '@/lib/admin-session';
import { getPermissions } from '@/lib/permissions';
import type { AdminRole } from '@streaming/shared';

export async function GET() {
  const session = await getSession();
  const authed = isAuthenticated(session);

  // For unauthenticated requests, return minimal info
  if (!authed) {
    return NextResponse.json({ isAdmin: false });
  }

  // Legacy session: user logged in with the old single ADMIN_PASSWORD_HASH.
  // Grant them SUPER_ADMIN equivalent permissions so existing UI keeps working.
  if (session.isLegacy) {
    return NextResponse.json({
      isAdmin: true,
      isLegacy: true,
      role: 'SUPER_ADMIN',
      permissions: getPermissions('SUPER_ADMIN'),
    });
  }

  return NextResponse.json({
    isAdmin: true,
    userId: session.userId,
    email: session.email,
    role: session.role,
    twoFactorVerified: session.twoFactorVerified,
    permissions: session.role ? getPermissions(session.role as AdminRole) : [],
  });
}
