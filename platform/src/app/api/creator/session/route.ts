// =========================================================================
// GET /api/creator/session — Check Creator Session
// =========================================================================
// Returns the current creator session data if authenticated.
// Used by the frontend to check login state on page load.
// =========================================================================

import { NextResponse } from 'next/server';
import { getCreatorSession, isCreatorAuthenticated } from '@/lib/creator-session';

export async function GET() {
  const session = await getCreatorSession();

  if (!isCreatorAuthenticated(session)) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    data: {
      creatorId: session.creatorId,
      email: session.email,
      channelId: session.channelId,
      channelSlug: session.channelSlug,
      displayName: session.displayName,
    },
  });
}
