import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mintPlaybackToken } from '@/lib/jwt';
import { env } from '@/lib/env';

// POST /api/admin/events/:id/preview — Mint a preview JWT for admin playback
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // Mint a JWT with a special admin preview subject (no real token code or session)
  const { token, expiresIn } = await mintPlaybackToken(
    '__admin_preview',
    event.id,
    '__admin_preview',
  );

  return NextResponse.json({
    playbackToken: token,
    playbackBaseUrl: env.HLS_SERVER_BASE_URL,
    streamPath: `/streams/${event.id}/stream.m3u8`,
    tokenExpiresIn: expiresIn,
    event: {
      title: event.title,
      streamType: event.streamType,
    },
  });
}
