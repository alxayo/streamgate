import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { getSession } from '@/lib/admin-session';
import { RateLimiter } from '@/lib/rate-limiter';
import { RATE_LIMIT_ADMIN_LOGIN } from '@streaming/shared';
import { env } from '@/lib/env';

const loginLimiter = new RateLimiter(RATE_LIMIT_ADMIN_LOGIN);

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const { allowed, retryAfterMs } = loginLimiter.check(ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((retryAfterMs ?? 60000) / 1000)) },
      },
    );
  }

  const body = await request.json();
  const { password } = body as { password?: string };

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  const isValid = await bcrypt.compare(password, env.ADMIN_PASSWORD_HASH);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const session = await getSession();
  session.isAdmin = true;
  await session.save();

  return NextResponse.json({ data: { success: true } });
}
