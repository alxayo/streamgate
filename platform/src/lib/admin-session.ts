// =========================================================================
// Admin Session Management
// =========================================================================
// Uses iron-session to store an encrypted, httpOnly cookie named "admin_session".
// The session data is encrypted with ADMIN_SESSION_SECRET using AES-256-GCM,
// so the server doesn't need a session store — everything is in the cookie.
//
// The session supports two modes:
//   1. **Multi-user mode** (new): userId + email + role + twoFactorVerified
//   2. **Legacy mode** (migration): isLegacy=true + isAdmin=true
//
// Auth Flow (multi-user):
//   Password OK → loginToken JWT (5 min) → TOTP verify → full session created
//
// Auth Flow (legacy):
//   Single password OK → session with isLegacy=true, isAdmin=true
// =========================================================================

import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_EXPIRY_SECONDS } from '@streaming/shared';
import type { AdminRole } from '@streaming/shared';
import { env } from './env';

/**
 * Shape of data stored in the encrypted session cookie.
 * All fields are optional because the cookie starts empty.
 */
export interface SessionData {
  // --- Multi-user session fields (new auth system) ---
  userId?: string;           // AdminUser.id from the database
  email?: string;            // User's email (for display/logging)
  role?: AdminRole;          // User's role (determines permissions)
  twoFactorVerified?: boolean; // True only after TOTP code verified

  // --- Legacy single-password session (backward compatibility) ---
  // These fields are set when no AdminUser records exist in the DB,
  // falling back to the old ADMIN_PASSWORD_HASH env var.
  isLegacy?: boolean;        // True = old single-password mode
  isAdmin?: boolean;         // True = password was correct
}

/** iron-session configuration — encrypts the cookie with ADMIN_SESSION_SECRET */
const sessionOptions = {
  password: env.ADMIN_SESSION_SECRET,
  cookieName: 'admin_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: ADMIN_SESSION_EXPIRY_SECONDS,
  },
};

/**
 * Read the session cookie from the current request.
 * Returns a mutable session object — call session.save() after making changes.
 */
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/**
 * Check if the session represents an authenticated admin.
 * Supports both the new multi-user system and legacy single-password mode.
 * 
 * Multi-user: authenticated when userId + role are set (2FA may still be pending)
 * Legacy: authenticated when isLegacy + isAdmin are both true
 */
export function isAuthenticated(session: SessionData): boolean {
  if (session.isLegacy && session.isAdmin) return true;
  if (session.userId && session.twoFactorVerified) return true;
  // User authenticated but hasn't completed 2FA setup yet
  if (session.userId && session.role) return true;
  return false;
}

/**
 * Require at least admin-level authentication.
 * Reads the session cookie and throws "Unauthorized" if not authenticated.
 * Use this in API routes that any authenticated admin can access.
 */
export async function requireAdmin(): Promise<SessionData> {
  const session = await getSession();
  if (!isAuthenticated(session)) {
    throw new Error('Unauthorized');
  }
  return session;
}

/**
 * Require one of the specified roles.
 * Throws "Unauthorized" if not logged in, "Forbidden" if role doesn't match.
 * Legacy sessions are treated as SUPER_ADMIN (full access for backward compat).
 * 
 * Example: await requireRole('SUPER_ADMIN', 'ADMIN');
 */
export async function requireRole(...roles: AdminRole[]): Promise<SessionData> {
  const session = await getSession();
  if (!isAuthenticated(session)) {
    throw new Error('Unauthorized');
  }
  // Legacy sessions get SUPER_ADMIN equivalent access
  if (session.isLegacy && session.isAdmin) return session;
  if (!session.role || !roles.includes(session.role)) {
    throw new Error('Forbidden');
  }
  return session;
}

