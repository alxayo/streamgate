// =========================================================================
// Creator Session Management
// =========================================================================
// Uses iron-session to store an encrypted, httpOnly cookie named "creator_session".
// This is entirely separate from the admin session — creators and admins have
// independent auth systems with different cookies, middleware, and routes.
//
// Auth Flow:
//   Email + Password → (optional 2FA) → full session with creatorId + channelId
// =========================================================================

import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { env } from './env';

/** Session expiry: 8 hours (same as admin) */
const CREATOR_SESSION_EXPIRY_SECONDS = 8 * 3600;

/**
 * Shape of data stored in the encrypted creator session cookie.
 */
export interface CreatorSessionData {
  creatorId?: string;        // Creator.id from the database
  email?: string;            // Creator's email (for display)
  channelId?: string;        // Active channel ID
  channelSlug?: string;      // Active channel slug (for URL building)
  displayName?: string;      // Creator's display name
  twoFactorVerified?: boolean; // True after TOTP verified (or if 2FA not enabled)
}

/** iron-session configuration — uses the same ADMIN_SESSION_SECRET for encryption */
const sessionOptions = {
  password: env.ADMIN_SESSION_SECRET,
  cookieName: 'creator_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: CREATOR_SESSION_EXPIRY_SECONDS,
  },
};

/**
 * Read the creator session cookie from the current request.
 * Returns a mutable session object — call session.save() after making changes.
 */
export async function getCreatorSession(): Promise<IronSession<CreatorSessionData>> {
  const cookieStore = await cookies();
  return getIronSession<CreatorSessionData>(cookieStore, sessionOptions);
}

/**
 * Check if the session represents an authenticated creator.
 */
export function isCreatorAuthenticated(session: CreatorSessionData): boolean {
  return !!(session.creatorId && session.channelId);
}

/**
 * Require creator authentication.
 * Reads the session cookie and returns session data or null if not authenticated.
 */
export async function requireCreator(): Promise<CreatorSessionData | null> {
  const session = await getCreatorSession();
  if (!isCreatorAuthenticated(session)) {
    return null;
  }
  return session;
}
