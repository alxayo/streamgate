import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';

// POST /api/admin/events/:id/purge — Purge all stream data for an event
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Verify the event exists
  const event = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // Call HLS server admin endpoint to purge cache + blobs
  const hlsBaseUrl = env.HLS_SERVER_BASE_URL;
  try {
    const response = await fetch(`${hlsBaseUrl}/admin/cache/${id}`, {
      method: 'DELETE',
      headers: { 'X-Internal-Api-Key': env.INTERNAL_API_KEY },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return NextResponse.json(
        { error: 'HLS server purge failed', details: body },
        { status: 502 },
      );
    }

    // Handle empty body (e.g. 204 No Content)
    const text = await response.text();
    const result = text ? JSON.parse(text) : { deletedCache: true };
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error(`Purge failed for event ${id}:`, error);
    return NextResponse.json(
      { error: 'Failed to reach HLS server' },
      { status: 502 },
    );
  }
}
