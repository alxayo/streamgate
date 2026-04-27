/**
 * POST /api/creator/events/:id/transcode
 *
 * Allows a creator to manually start (or retry) transcoding for an uploaded video.
 *
 * Use cases:
 * - Creator uploads a video and clicks "Start Transcoding"
 * - Transcoding failed and the creator wants to retry
 *
 * This endpoint:
 * 1. Verifies the creator is logged in and owns the event
 * 2. Checks that the event has an upload in a valid state
 * 3. Cleans up any existing transcode jobs (for retry scenarios)
 * 4. Calls triggerTranscoding() to create new jobs and launch containers
 *
 * Auth: Creator session cookie (via requireCreator())
 */

import { NextResponse } from 'next/server';

import { requireCreator } from '@/lib/creator-session';
import { prisma } from '@/lib/prisma';
import { triggerTranscoding } from '@/lib/trigger-transcode';

/**
 * Next.js 14+ route params pattern — params is a Promise that resolves
 * to the dynamic route segments. Here, [id] is the event ID.
 */
interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: Request,
  { params }: RouteParams,
) {
  // ──────────────────────────────────────────────────────────────────────────
  // Step 1: Authenticate the creator
  // ──────────────────────────────────────────────────────────────────────────
  // requireCreator() checks the session cookie and returns the creator's info
  // (including their channelId) or null if not logged in.
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const { id } = await params;

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2: Verify the event exists and belongs to the creator's channel
  // ──────────────────────────────────────────────────────────────────────────
  // We check channelId to ensure a creator can only trigger transcoding for
  // their own events — not someone else's.
  const event = await prisma.event.findFirst({
    where: {
      id,
      channelId: session.channelId,
    },
    select: {
      id: true,
      // Include the Upload relation so we can check its status
      upload: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!event) {
    return NextResponse.json(
      { error: 'Event not found' },
      { status: 404 },
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3: Validate that the event has an upload in a valid state
  // ──────────────────────────────────────────────────────────────────────────
  // The upload must exist and be in one of these states:
  // - UPLOADED: fresh upload ready for first transcoding
  // - FAILED:   previous transcoding failed, creator wants to retry
  //
  // We do NOT allow re-triggering while TRANSCODING is in progress (to avoid
  // duplicate containers running), or when already READY (nothing to do).
  if (!event.upload) {
    return NextResponse.json(
      { error: 'No upload found for this event' },
      { status: 400 },
    );
  }

  const { upload } = event;
  const allowedStatuses = ['UPLOADED', 'FAILED'];

  if (!allowedStatuses.includes(upload.status)) {
    return NextResponse.json(
      {
        error: `Cannot trigger transcoding: upload status is ${upload.status}`,
      },
      { status: 409 },
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Step 4: Clean up existing transcode jobs if retrying
  // ──────────────────────────────────────────────────────────────────────────
  // If the creator is retrying after a failure, there may be old TranscodeJob
  // records from the previous attempt. We delete them so we start fresh.
  // This avoids confusion with stale FAILED/PENDING records.
  await prisma.transcodeJob.deleteMany({
    where: { uploadId: upload.id },
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 5: Trigger transcoding
  // ──────────────────────────────────────────────────────────────────────────
  // This creates new TranscodeJob records, launches the transcoder containers,
  // and returns how many succeeded vs failed to start.
  const result = await triggerTranscoding(upload.id, event.id);

  return NextResponse.json({ data: result });
}
