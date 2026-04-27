// =========================================================================
// Creator Upload Status — GET /api/creator/events/:id/upload
// =========================================================================
// Returns the current upload status for a VOD event, including per-codec
// transcoding job progress. Used by the creator UI to poll and display
// real-time transcoding progress bars.
//
// Auth: Creator session cookie (must own the event's channel).
//
// Response shape:
//   { data: { upload: UploadWithJobs | null } }
//   - null when no upload exists for this event yet
//   - Includes jobs[] array with per-codec status and progress
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireCreator } from '@/lib/creator-session';

// Next.js 14+ dynamic route params are delivered as a Promise
interface RouteParams {
  params: Promise<{ id: string }>;
}

// ── GET handler ─────────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteParams) {
  // 1. Authenticate — only logged-in creators may call this endpoint
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Extract the event ID from the URL path
  const { id } = await params;

  // 3. Look up the event, scoping to the creator's own channel so they
  //    cannot peek at uploads belonging to other channels.
  const event = await prisma.event.findFirst({
    where: { id, channelId: session.channelId },
    select: { id: true },
  });

  if (!event) {
    // 404 whether the event doesn't exist or belongs to another channel —
    // we intentionally don't distinguish to avoid leaking IDs.
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // 4. Fetch the upload (if any) together with its per-codec transcode jobs.
  //    An event may have zero or one upload (the relation is @unique on eventId).
  const upload = await prisma.upload.findUnique({
    where: { eventId: event.id },
    include: {
      transcodeJobs: {
        orderBy: { codec: 'asc' },
        select: {
          id: true,
          codec: true,
          status: true,
          progress: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
        },
      },
    },
  });

  // 5. Serialise — BigInt values (fileSize) are not natively JSON-serialisable,
  //    so we convert fileSize to a string before returning.
  const serialised = upload
    ? { ...upload, fileSize: upload.fileSize.toString() }
    : null;

  return NextResponse.json({ data: { upload: serialised } });
}
