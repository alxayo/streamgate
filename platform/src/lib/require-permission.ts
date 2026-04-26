// =========================================================================
// API Route Permission Guard
// =========================================================================
// This module provides a reusable function to check permissions in API routes.
// Drop it at the top of any API handler to enforce authorization:
//
//   export async function POST(request: NextRequest) {
//     const denied = await checkPermission('events:create');
//     if (denied) return denied;  // Returns 401 or 403 response
//     // ... rest of the handler (user is authorized)
//   }
//
// Legacy sessions (from the old single-password system) get full access,
// equivalent to SUPER_ADMIN, to avoid breaking existing functionality.
// =========================================================================

import { NextResponse } from 'next/server';
import { getSession, isAuthenticated } from './admin-session';
import { hasPermission, type Permission } from './permissions';
import type { AdminRole } from '@streaming/shared';

/**
 * Checks if the current session has the required permission.
 * Returns null if authorized, or a NextResponse error (401/403) if not.
 *
 * Usage in API routes:
 *   const denied = await checkPermission('events:create');
 *   if (denied) return denied;  // Short-circuit: returns error response to client
 *   // If we reach here, the user has the 'events:create' permission
 */
export async function checkPermission(permission: Permission): Promise<NextResponse | null> {
  const session = await getSession();

  if (!isAuthenticated(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Legacy sessions have full access (equivalent to SUPER_ADMIN)
  if (session.isLegacy && session.isAdmin) {
    return null;
  }

  if (!session.role || !hasPermission(session.role as AdminRole, permission)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return null;
}
