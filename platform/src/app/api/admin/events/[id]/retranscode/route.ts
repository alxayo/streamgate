// =========================================================================
// Admin Retranscode — POST /api/admin/events/:id/retranscode
// =========================================================================
// Allows admins to retry transcoding for an upload that previously failed.
// This is useful when a transient error (network timeout, container crash, etc.)
// caused the original transcode to fail and the admin wants to try again
// without re-uploading the file.
//
// What this endpoint does:
//   1. Verifies admin auth with events:manage permission
//   2. Checks that the event has an upload in FAILED state
//   3. Deletes any existing TranscodeJob records for the upload
//      (so the transcoder starts fresh with no stale state)
//   4. Calls triggerTranscoding() to launch new Container Apps Job executions
//   5. Returns the number of jobs launched and failed
//
// Auth: Admin session cookie + events:manage permission.
//
// Response shape:
//   { data: { launched: number, failed: number } }
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
import { triggerTranscoding } from '@/lib/trigger-transcode';

// Next.js 14+ dynamic route params are delivered as a Promise
interface RouteParams {
  params: Promise<{ id: string }>;
}

// ── POST handler ────────────────────────────────────────────────────────
export async function POST(_request: NextRequest, { params }: RouteParams) {
  // ── Step 1: Authenticate ──────────────────────────────────────────────
  // Require admin session with the "events:manage" permission. This is an
  // admin-only action — creators retry transcoding through their own UI.
  const denied = await checkPermission('events:edit');
  if (denied) return denied;

  // ── Step 2: Extract event ID from URL path ────────────────────────────
  const { id } = await params;

  // ── Step 3: Verify the event exists ───────────────────────────────────
  // Admins can retranscode any event — no channel-ownership check needed.
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // ── Step 4: Find the upload and verify it's in FAILED state ───────────
  // We can only retry transcoding for uploads that previously failed. If
  // the upload is in any other state (UPLOADING, UPLOADED, TRANSCODING,
  // READY), retranscoding doesn't make sense:
  //   - UPLOADING: file isn't on disk yet
  //   - UPLOADED: hasn't been transcoded yet (use the normal flow)
  //   - TRANSCODING: already in progress
  //   - READY: already succeeded, no need to retry
  const upload = await prisma.upload.findUnique({
    where: { eventId: event.id },
    select: { id: true, status: true },
  });

  if (!upload) {
    return NextResponse.json(
      { error: 'No upload found for this event' },
      { status: 404 },
    );
  }

  if (upload.status !== 'FAILED') {
    return NextResponse.json(
      { error: `Upload is in "${upload.status}" state. Retranscoding is only allowed for FAILED uploads.` },
      { status: 409 },
    );
  }

  // ── Step 5: Delete existing TranscodeJob records ──────────────────────
  // Remove all previous transcode jobs for this upload so we start fresh.
  // Old jobs may have stale execution references and error messages
  // that are no longer relevant. deleteMany is safe even if there are no
  // existing jobs (it just deletes zero rows).
  await prisma.transcodeJob.deleteMany({
    where: { uploadId: upload.id },
  });

  // ── Step 6: Trigger new transcoding ───────────────────────────────────
  // triggerTranscoding() creates new TranscodeJob records and launches
  // Container Apps Job executions for each configured codec. It returns
  // jobs were successfully launched vs. how many failed to launch.
  const { launched, failed } = await triggerTranscoding(upload.id, event.id);

  // ── Step 7: Return the result ─────────────────────────────────────────
  // The admin UI can use these counts to show whether the retry succeeded.
  // If all jobs failed to launch, the admin might need to check Azure
  // credentials or container configuration.
  return NextResponse.json({ data: { launched, failed } });
}
