import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getConfigValue, CONFIG_KEYS } from '@/lib/system-config';

type RtmpHookEvent = {
  type?: string;
  timestamp?: number;
  conn_id?: string;
  stream_key?: string;
  data?: Record<string, unknown>;
};

/**
 * rtmp-go sends stream keys in `app/streamName` form (for example `live/my-event-a3b2c1d0e9f8`).
 * Streamgate stores only the `streamName` portion in Event.rtmpStreamKeyHash, so the hook receiver
 * must strip the RTMP app prefix before looking up the event.
 *
 * We keep everything after the first slash to avoid breaking stream names that themselves contain `/`.
 */
function extractStreamKeyHash(streamKey: string): string {
  const parts = streamKey.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : streamKey;
}

/**
 * POST /api/rtmp/hooks — Webhook receiver for rtmp-go lifecycle events
 *
 * Called by rtmp-go's webhook hook system when streaming events occur.
 * This endpoint accepts rtmp-go's native hook event format and dispatches
 * by event type. The primary use case is receiving `publish_stop` events
 * to close active RtmpSession records, which unblocks stream reconnection.
 *
 * Without this endpoint, Streamgate never learns when a stream ends,
 * causing the `already_streaming` error on reconnection attempts.
 *
 * Authentication: X-Internal-Api-Key header (shared secret with rtmp-go)
 *
 * Request body (rtmp-go hook event format):
 *   {
 *     "type": "publish_start" | "publish_stop" | string,
 *     "timestamp": number,
 *     "conn_id": string,
 *     "stream_key": string,
 *     "data": object
 *   }
 *
 * Response: Usually 200 OK (fire-and-forget from rtmp-go's perspective)
 *   { "ok": true, "action": "session_closed" | "logged" | "ignored" }
 *
 * We intentionally do not reject unknown hook types. rtmp-go treats hooks as best-effort audit/event
 * notifications, so returning 200 for unhandled events preserves forward compatibility and avoids noisy
 * server-side errors for events Streamgate does not care about yet.
 */
export async function POST(request: NextRequest) {
  // Reuse the same shared-secret validation pattern as the RTMP auth/disconnect endpoints.
  const apiKey = request.headers.get('X-Internal-Api-Key');
  const expectedKey = await getConfigValue(prisma, CONFIG_KEYS.INTERNAL_API_KEY);

  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401 },
    );
  }

  let body: RtmpHookEvent;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = typeof body?.type === 'string' ? body.type : 'unknown';
  const rawStreamKey = typeof body?.stream_key === 'string' ? body.stream_key.trim() : '';

  // Hooks are fire-and-forget. If the payload is malformed, log it and acknowledge the request
  // so a noisy or partial hook payload from rtmp-go does not disrupt the streaming lifecycle.
  if (!rawStreamKey) {
    console.warn('RTMP hook ignored: missing stream_key', {
      type: eventType,
      connId: body?.conn_id,
      timestamp: body?.timestamp,
    });
    return NextResponse.json({ ok: true, action: 'ignored' }, { status: 200 });
  }

  const streamKeyHash = extractStreamKeyHash(rawStreamKey);

  try {
    switch (eventType) {
      case 'publish_stop': {
        const event = await prisma.event.findUnique({
          where: { rtmpStreamKeyHash: streamKeyHash },
          select: { id: true, title: true, rtmpStreamKeyHash: true },
        });

        if (!event) {
          console.info('RTMP publish_stop ignored: event not found for stream key', {
            connId: body.conn_id,
            streamKey: rawStreamKey,
            streamKeyHash,
          });
          return NextResponse.json({ ok: true, action: 'ignored' }, { status: 200 });
        }

        const endedAt = new Date();
        const updated = await prisma.rtmpSession.updateMany({
          where: {
            eventId: event.id,
            endedAt: null,
          },
          data: {
            endedAt,
          },
        });

        console.info('RTMP publish_stop processed', {
          eventId: event.id,
          eventTitle: event.title,
          connId: body.conn_id,
          streamKey: rawStreamKey,
          streamKeyHash,
          closedSessions: updated.count,
          metrics: body.data,
        });

        return NextResponse.json({
          ok: true,
          action: 'session_closed',
          closedSessions: updated.count,
        }, { status: 200 });
      }

      case 'publish_start':
        console.info('RTMP publish_start received', {
          connId: body.conn_id,
          streamKey: rawStreamKey,
          streamKeyHash,
          timestamp: body.timestamp,
          data: body.data,
        });
        return NextResponse.json({ ok: true, action: 'logged' }, { status: 200 });

      default:
        console.info('RTMP hook ignored: unsupported type', {
          type: eventType,
          connId: body.conn_id,
          streamKey: rawStreamKey,
          streamKeyHash,
        });
        return NextResponse.json({ ok: true, action: 'ignored' }, { status: 200 });
    }
  } catch (error) {
    console.error('Failed to process RTMP hook event', {
      type: eventType,
      connId: body.conn_id,
      streamKey: rawStreamKey,
      streamKeyHash,
      error,
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
