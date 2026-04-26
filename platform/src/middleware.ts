// =========================================================================
// Admin Route Protection Middleware
// =========================================================================
// This Next.js middleware runs before every request to /admin/* and /api/admin/*.
// It enforces three layers of protection:
//
// 1. IP Restriction (optional): If ADMIN_ALLOWED_IP is set, only requests
//    from that IP address can access admin routes.
//
// 2. Authentication: Reads the iron-session cookie and checks if the user
//    is logged in (either via the new multi-user system or legacy mode).
//    Unauthenticated requests are redirected to /admin/login (pages) or
//    get a 401 JSON response (API routes).
//
// 3. 2FA Enforcement: For multi-user sessions where twoFactorVerified is
//    false, redirects to /admin/setup-2fa (unless already on a 2FA setup path).
//    This ensures new users complete 2FA setup before accessing the admin console.
//
// Some paths are public (login, session check, 2FA verification endpoints)
// to allow the authentication flow to complete.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import type { SessionData } from '@/lib/admin-session';

/**
 * Extract the client's real IP address from proxy headers.
 * Azure Container Apps and nginx set X-Forwarded-For.
 */
function getClientIp(request: NextRequest): string {
  // Azure Container Apps / reverse proxies set X-Forwarded-For
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/** Routes that don't require authentication — these are needed for the
 *  login flow itself (login page, login API, session check, 2FA verify) */
const PUBLIC_PATHS = [
  '/admin/login',
  '/api/admin/login',
  '/api/admin/session',
  '/api/admin/verify-2fa',
  '/api/admin/verify-recovery',
  '/api/admin/emergency-login',
];

/** Routes allowed when authenticated but 2FA setup is still pending.
 *  The user needs access to these to complete 2FA setup and to log out. */
const SETUP_2FA_PATHS = [
  '/admin/setup-2fa',
  '/api/admin/2fa/setup',
  '/api/admin/2fa/confirm',
  '/api/admin/logout',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isSetup2FAPath(pathname: string): boolean {
  return SETUP_2FA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // IP-based admin access restriction (if ADMIN_ALLOWED_IP is set)
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const allowedIp = process.env.ADMIN_ALLOWED_IP;
    if (allowedIp) {
      const clientIp = getClientIp(request);
      if (clientIp !== allowedIp) {
        if (pathname.startsWith('/api/admin')) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        return new NextResponse('Forbidden', { status: 403 });
      }
    }
  }

  // Skip public endpoints (login, 2FA verify, emergency login)
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Protect admin pages and API routes
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const response = NextResponse.next();
    const session = await getIronSession<SessionData>(request, response, {
      password: process.env.ADMIN_SESSION_SECRET!,
      cookieName: 'admin_session',
    });

    // Check authentication
    const isAuthed =
      (session.isLegacy && session.isAdmin) ||
      (session.userId && session.role);

    if (!isAuthed) {
      if (pathname.startsWith('/api/admin')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }

    // For non-legacy sessions: enforce 2FA setup
    if (!session.isLegacy && session.userId && session.role) {
      const needs2FASetup = !session.twoFactorVerified;
      if (needs2FASetup && !isSetup2FAPath(pathname)) {
        if (pathname.startsWith('/api/admin')) {
          return NextResponse.json(
            { error: '2FA setup required', redirect: '/admin/setup-2fa' },
            { status: 403 }
          );
        }
        return NextResponse.redirect(new URL('/admin/setup-2fa', request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};

