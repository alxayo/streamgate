// =========================================================================
// POST /api/creator/logout — Creator Logout
// =========================================================================
// Destroys the creator session cookie.
// =========================================================================

import { NextResponse } from 'next/server';
import { getCreatorSession } from '@/lib/creator-session';

export async function POST() {
  const session = await getCreatorSession();
  session.destroy();
  return NextResponse.json({ success: true });
}
