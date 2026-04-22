import { NextRequest, NextResponse } from 'next/server';
import { getIronSession } from 'iron-session';
import type { SessionData } from '@/lib/admin-session';

function getClientIp(request: NextRequest): string {
  // Azure Container Apps / reverse proxies set X-Forwarded-For
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
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

  // Skip login page and public API endpoints
  if (
    pathname === '/admin/login' ||
    pathname.startsWith('/api/admin/login') ||
    pathname.startsWith('/api/admin/session')
  ) {
    return NextResponse.next();
  }

  // Protect admin pages and API routes
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const response = NextResponse.next();
    const session = await getIronSession<SessionData>(request, response, {
      password: process.env.PLAYBACK_SIGNING_SECRET!,
      cookieName: 'admin_session',
    });

    if (!session.isAdmin) {
      // API routes: return 401
      if (pathname.startsWith('/api/admin')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      // Page routes: redirect to login
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
