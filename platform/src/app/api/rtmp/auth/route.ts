import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

// POST /api/rtmp/auth — Callback endpoint for RTMP server auth validation
// The RTMP server sends a JSON body for each publish/play request:
// { action, app, stream_name, stream_key, token, remote_addr }
// Returns 200 to allow, 403 to deny.
//
// Security: This endpoint validates the RTMP auth token in the request body.
// The token itself serves as authentication — only callers with the correct
// RTMP_AUTH_TOKEN can get a 200 response. No additional header auth is needed.
export async function POST(request: NextRequest) {

  let body: {
    action?: string;
    app?: string;
    stream_name?: string;
    stream_key?: string;
    token?: string;
    remote_addr?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, stream_name, token } = body;

  if (!action || !stream_name || !token) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Validate the RTMP auth token
  const expectedToken = process.env.RTMP_AUTH_TOKEN;
  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // For publish requests, verify the stream name is a valid active event
  if (action === 'publish') {
    const event = await prisma.event.findUnique({
      where: { id: stream_name },
      select: { id: true, isActive: true, autoPurge: true },
    });

    if (!event) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!event.isActive) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Auto-purge: clear stale segments before the new stream starts
    if (event.autoPurge) {
      try {
        const hlsBaseUrl = env.HLS_SERVER_BASE_URL;
        await fetch(`${hlsBaseUrl}/admin/cache/${stream_name}`, {
          method: 'DELETE',
          headers: { 'X-Internal-Api-Key': env.INTERNAL_API_KEY },
          signal: AbortSignal.timeout(5000),
        });
      } catch (error) {
        // Best-effort: don't block publish if purge fails
        console.error(`Auto-purge failed for event ${stream_name}:`, error);
      }
    }
  }

  // Allow the request
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
