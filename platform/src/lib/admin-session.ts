import { getIronSession, type IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { ADMIN_SESSION_EXPIRY_SECONDS } from '@streaming/shared';
import { env } from './env';

export interface SessionData {
  isAdmin: boolean;
}

const sessionOptions = {
  password: env.PLAYBACK_SIGNING_SECRET,
  cookieName: 'admin_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    maxAge: ADMIN_SESSION_EXPIRY_SECONDS,
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function requireAdmin(): Promise<void> {
  const session = await getSession();
  if (!session.isAdmin) {
    throw new Error('Unauthorized');
  }
}
