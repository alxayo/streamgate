/**
 * Internal API: System-Wide Stream Config Defaults
 * =================================================
 * GET /api/internal/stream-config/defaults
 *
 * Called by the HLS Transcoder at startup (and periodically to refresh its cache).
 * Returns the raw system-wide defaults — no event-specific data, no merge logic.
 *
 * The transcoder caches these so it has a fallback when per-event fetches fail.
 * See plan §1.3b and the four-tier fallback chain in §4.1.
 *
 * Auth: X-Internal-Api-Key header.
 * Uses the same upsert bootstrap guard as the per-event endpoint — never 500s.
 */
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { getSystemDefaults } from '@/lib/stream-config';

export async function GET(request: NextRequest) {
  // Authenticate — reject requests without a valid internal API key
  const apiKey = request.headers.get('x-internal-api-key');
  if (apiKey !== env.INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch system defaults (bootstrap guard ensures this never fails)
  const defaults = await getSystemDefaults();

  return NextResponse.json({
    transcoder: defaults.transcoder,
    player: defaults.player,
  });
}
