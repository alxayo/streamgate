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

function getConnId(body: RtmpHookEvent): string | null {
  return typeof body.conn_id === 'string' && body.conn_id.trim().length > 0
    ? body.conn_id.trim()
    : null;
}

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
 * The `conn_id` field is important: it identifies one RTMP TCP connection.
 * We store it on `publish_start`, then require the same value on `publish_stop`
 * before closing the session. That prevents an old, delayed stop event from
 * accidentally closing a newer publisher's active stream.
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
  const connId = getConnId(body);

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
        const activeSessions = await prisma.rtmpSession.findMany({
          where: { eventId: event.id, endedAt: null },
          orderBy: { startedAt: 'desc' },
          select: { id: true, connId: true, startedAt: true },
        });

        if (activeSessions.length === 0) {
          console.info('RTMP publish_stop ignored: no active session', {
            eventId: event.id,
            eventTitle: event.title,
            connId,
            streamKey: rawStreamKey,
            streamKeyHash,
          });
          return NextResponse.json({ ok: true, action: 'ignored_no_active_session' }, { status: 200 });
        }

        // Choose exactly which DB sessions this stop hook is allowed to close.
        // Normally there is one active session and it already has the same conn_id.
        // The fallback for a single session with no connId keeps older rows working
        // during rollout, before the first publish_start hook has tagged them.
        let sessionsToClose = activeSessions;
        if (connId) {
          const matchingSessions = activeSessions.filter((session) => session.connId === connId);
          if (matchingSessions.length > 0) {
            sessionsToClose = matchingSessions;
          } else if (activeSessions.length === 1 && !activeSessions[0].connId) {
            sessionsToClose = activeSessions;
          } else {
            console.warn('RTMP publish_stop ignored: stale conn_id mismatch', {
              eventId: event.id,
              eventTitle: event.title,
              connId,
              activeConnIds: activeSessions.map((session) => session.connId),
              streamKey: rawStreamKey,
              streamKeyHash,
            });
            return NextResponse.json({ ok: true, action: 'ignored_stale_conn_id' }, { status: 200 });
          }
        }

        const updated = await prisma.rtmpSession.updateMany({
          where: { id: { in: sessionsToClose.map((session) => session.id) } },
          data: {
            endedAt,
            endedReason: 'publish_stop',
            endedMetadata: body.data ? JSON.stringify(body.data) : null,
          },
        });

        console.info('RTMP publish_stop processed', {
          eventId: event.id,
          eventTitle: event.title,
          connId,
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

      case 'publish_start': {
        const event = await prisma.event.findUnique({
          where: { rtmpStreamKeyHash: streamKeyHash },
          select: { id: true, title: true },
        });

        if (!event) {
          console.info('RTMP publish_start ignored: event not found for stream key', {
            connId,
            streamKey: rawStreamKey,
            streamKeyHash,
          });
          return NextResponse.json({ ok: true, action: 'ignored' }, { status: 200 });
        }

        const activeSessions = await prisma.rtmpSession.findMany({
          where: { eventId: event.id, endedAt: null },
          orderBy: { startedAt: 'desc' },
          select: { id: true, connId: true, startedAt: true },
        });

        let action = 'logged';
        if (connId && activeSessions.length === 1) {
          const activeSession = activeSessions[0];
          if (!activeSession.connId) {
            // Auth creates the RtmpSession before rtmp-go starts publishing media.
            // The auth payload does not include conn_id, so the first publish_start
            // hook fills it in once rtmp-go knows the connection ID.
            await prisma.rtmpSession.update({
              where: { id: activeSession.id },
              data: { connId, streamKey: rawStreamKey },
            });
            action = 'session_tagged';
          } else if (activeSession.connId === connId) {
            action = 'already_tagged';
          } else {
            action = 'ignored_conn_id_mismatch';
            console.warn('RTMP publish_start ignored: active session has different conn_id', {
              eventId: event.id,
              eventTitle: event.title,
              connId,
              activeConnId: activeSession.connId,
              streamKey: rawStreamKey,
              streamKeyHash,
            });
          }
        } else if (!connId) {
          action = 'ignored_missing_conn_id';
        } else if (activeSessions.length === 0) {
          action = 'ignored_no_active_session';
        } else {
          action = 'ignored_ambiguous_active_sessions';
          console.warn('RTMP publish_start ignored: ambiguous active sessions', {
            eventId: event.id,
            eventTitle: event.title,
            connId,
            activeSessionCount: activeSessions.length,
            streamKey: rawStreamKey,
            streamKeyHash,
          });
        }

        console.info('RTMP publish_start received', {
          eventId: event.id,
          eventTitle: event.title,
          action,
          connId,
          streamKey: rawStreamKey,
          streamKeyHash,
          timestamp: body.timestamp,
          data: body.data,
        });
        return NextResponse.json({ ok: true, action }, { status: 200 });
      }

      default:
        console.info('RTMP hook ignored: unsupported type', {
          type: eventType,
          connId,
          streamKey: rawStreamKey,
          streamKeyHash,
        });
        return NextResponse.json({ ok: true, action: 'ignored' }, { status: 200 });
    }
  } catch (error) {
    console.error('Failed to process RTMP hook event', {
      type: eventType,
      connId,
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
