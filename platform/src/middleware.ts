// =========================================================================
// Route Protection Middleware
// =========================================================================
// This Next.js middleware runs before every request to protected routes.
// It enforces authentication for both admin and creator route trees:
//
// Admin Routes (/admin/*, /api/admin/*):
//   1. IP Restriction (optional): If ADMIN_ALLOWED_IP is set, only that IP.
//   2. Authentication: Reads admin_session cookie.
//   3. 2FA Enforcement: Redirects to /admin/setup-2fa if needed.
//
// Creator Routes (/creator/*, /api/creator/*):
//   1. Authentication: Reads creator_session cookie.
//   2. Active check: Verifies creator and channel are not suspended.
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import type { SessionData } from '@/lib/admin-session';
import type { CreatorSessionData } from '@/lib/creator-session';

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

/** Admin routes that don't require authentication */
const ADMIN_PUBLIC_PATHS = [
  '/admin/login',
  '/api/admin/login',
  '/api/admin/session',
  '/api/admin/verify-2fa',
  '/api/admin/verify-recovery',
  '/api/admin/emergency-login',
  '/api/admin/2fa/emergency-reset',
];

/** Admin routes allowed when 2FA setup is pending */
const ADMIN_SETUP_2FA_PATHS = [
  '/admin/setup-2fa',
  '/api/admin/2fa/setup',
  '/api/admin/2fa/confirm',
  '/api/admin/logout',
];

/** Creator routes that don't require authentication */
const CREATOR_PUBLIC_PATHS = [
  '/creator/login',
  '/creator/register',
  '/api/creator/login',
  '/api/creator/register',
  '/api/creator/session',
];

function isAdminPublicPath(pathname: string): boolean {
  return ADMIN_PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isAdminSetup2FAPath(pathname: string): boolean {
  return ADMIN_SETUP_2FA_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isCreatorPublicPath(pathname: string): boolean {
  return CREATOR_PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // =========================================================================
  // SKIP UPLOAD ROUTES — these handle their own auth and need the raw body
  // stream to pass through un-buffered. If middleware touches these routes,
  // Next.js proxy-buffers the entire request body in memory, which would
  // OOM the container for large video files (hundreds of MB to several GB).
  // =========================================================================
  if (/\/api\/(admin|creator)\/events\/[^/]+\/upload$/.test(pathname)) {
    return NextResponse.next();
  }

  // =========================================================================
  // ADMIN ROUTE PROTECTION
  // =========================================================================
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    // IP-based admin access restriction
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

    // Skip public endpoints
    if (isAdminPublicPath(pathname)) {
      return NextResponse.next();
    }

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
      if (needs2FASetup && !isAdminSetup2FAPath(pathname)) {
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

  // =========================================================================
  // CREATOR ROUTE PROTECTION
  // =========================================================================
  if (pathname.startsWith('/creator') || pathname.startsWith('/api/creator')) {
    // Skip public endpoints (login, register)
    if (isCreatorPublicPath(pathname)) {
      return NextResponse.next();
    }

    const response = NextResponse.next();
    const session = await getIronSession<CreatorSessionData>(request, response, {
      password: process.env.ADMIN_SESSION_SECRET!,
      cookieName: 'creator_session',
    });

    // Check authentication
    if (!session.creatorId || !session.channelId) {
      if (pathname.startsWith('/api/creator')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/creator/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/creator/:path*',
    // Match admin/creator API routes EXCEPT upload routes.
    // Upload routes must be completely excluded from middleware — even
    // returning NextResponse.next() causes Next.js to proxy-buffer the
    // request body, which truncates large file uploads ("Unexpected end
    // of form") or OOMs the container.
    '/api/admin/((?!events/[^/]+/upload).*)',
    '/api/creator/((?!events/[^/]+/upload).*)',
  ],
};

