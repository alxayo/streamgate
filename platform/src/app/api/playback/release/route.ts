import { NextRequest, NextResponse } from 'next/server';
import { verifyPlaybackToken } from '@/lib/jwt';
import { releaseSession } from '@/lib/session-service';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Authorization required' }, { status: 401 });
  }

  const jwt = authHeader.slice(7);

  let claims;
  try {
    claims = await verifyPlaybackToken(jwt);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  const sessionId = claims.sid;

  try {
    await releaseSession(sessionId);
  } catch {
    // Session may already be released or expired — that's fine
  }

  return NextResponse.json({ released: true });
}
