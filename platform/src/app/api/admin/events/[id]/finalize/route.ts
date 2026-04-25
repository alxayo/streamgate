import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

// POST /api/admin/events/:id/finalize — Finalize event as VOD
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Verify the event exists
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, streamType: true },
  });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  if (event.streamType === 'VOD') {
    return NextResponse.json({ error: 'Event is already VOD' }, { status: 409 });
  }

  // Call HLS server to rebuild playlists as VOD
  const hlsBaseUrl = env.HLS_SERVER_BASE_URL;
  try {
    const response = await fetch(`${hlsBaseUrl}/admin/finalize/${id}`, {
      method: 'POST',
      headers: { 'X-Internal-Api-Key': env.INTERNAL_API_KEY },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: 'HLS server finalize failed', details: body },
        { status: 502 },
      );
    }

    const result = await response.json();

    // Update the event to VOD in the database
    await prisma.event.update({
      where: { id },
      data: { streamType: 'VOD' },
    });

    return NextResponse.json({ data: { ...result, streamType: 'VOD' } });
  } catch (error) {
    console.error(`Finalize failed for event ${id}:`, error);
    return NextResponse.json(
      { error: 'Failed to reach HLS server' },
      { status: 502 },
    );
  }
}
