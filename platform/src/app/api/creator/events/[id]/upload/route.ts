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
import { getSystemDefaults } from '@/lib/stream-config';
import { streamMultipartToDisk } from '@/lib/stream-upload';
import { triggerTranscoding } from '@/lib/trigger-transcode';
import { ALLOWED_VIDEO_MIME_TYPES } from '@streaming/shared';
import { unlink, rmdir } from 'fs/promises';
import path from 'path';

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

// ── POST handler — Upload a video file for VOD transcoding ──────────────
// Accepts multipart/form-data with a single "file" field.
// Saves the file to disk and creates an Upload record in the database.
// Returns 202 Accepted when the file has been saved successfully.
// ─────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  // ── Step 1: Authenticate ──────────────────────────────────────────────
  // Only logged-in creators may upload files. requireCreator() checks the
  // session cookie and returns { creatorId, channelId } or null.
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Step 2: Extract event ID from URL path ────────────────────────────
  // Next.js 14+ delivers dynamic route params as a Promise, so we await it.
  const { id } = await params;

  // ── Step 3: Verify event ownership ────────────────────────────────────
  // We scope the query to the creator's own channel so they can't upload
  // to events belonging to other channels. We also select streamType to
  // validate that this is a VOD event (not a LIVE one).
  const event = await prisma.event.findFirst({
    where: { id, channelId: session.channelId },
    select: { id: true, streamType: true },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // ── Step 4: Reject uploads to LIVE events ─────────────────────────────
  // Only VOD events accept file uploads — LIVE events use RTMP ingest.
  if (event.streamType !== 'VOD') {
    return NextResponse.json(
      { error: 'File uploads are only allowed for VOD events' },
      { status: 400 },
    );
  }

  // ── Step 5: Check for duplicate in-progress uploads ───────────────────
  // If there's already an upload in UPLOADING or TRANSCODING state, we
  // must not allow another one. This prevents race conditions where two
  // uploads overwrite each other or trigger duplicate transcode jobs.
  const existingUpload = await prisma.upload.findUnique({
    where: { eventId: event.id },
    select: { id: true, status: true },
  });

  if (existingUpload && (existingUpload.status === 'UPLOADING' || existingUpload.status === 'TRANSCODING')) {
    return NextResponse.json(
      { error: 'An upload is already in progress for this event' },
      { status: 409 },
    );
  }

  // ── Step 6: Stream file to disk ─────────────────────────────────────
  // Use the streaming multipart parser to pipe the file directly from the
  // HTTP request to disk — never holding the full file in memory. This is
  // essential: the container has limited RAM (e.g. 1 GB) and video files
  // can be hundreds of MB or several GB.
  const { maxUploadSizeBytes } = await getSystemDefaults();
  const uploadDir = path.join(process.cwd(), 'uploads', event.id);

  let streamResult;
  try {
    streamResult = await streamMultipartToDisk(
      request,
      uploadDir,
      'file',                              // form field name
      Number(maxUploadSizeBytes),           // max file size in bytes
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    const isValidation = msg.includes('Missing') || msg.includes('exceeds') || msg.includes('multipart');
    return NextResponse.json(
      { error: msg },
      { status: isValidation ? 400 : 500 },
    );
  }

  // ── Step 7: Validate MIME type ────────────────────────────────────────
  // busboy reports the MIME type from the Content-Type of the file part.
  // We only accept specific video container formats.
  if (!(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(streamResult.mimeType)) {
    try { await unlink(streamResult.filePath); } catch { /* best-effort cleanup */ }
    return NextResponse.json(
      { error: `Unsupported file type: ${streamResult.mimeType}. Allowed: ${ALLOWED_VIDEO_MIME_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  // ── Step 8: Delete previous upload if re-uploading ───────────────────
  // If there's an existing upload in READY or FAILED state, the creator is
  // re-uploading. We delete the old record to make room for the new one.
  if (existingUpload && (existingUpload.status === 'READY' || existingUpload.status === 'FAILED')) {
    await prisma.upload.delete({ where: { id: existingUpload.id } });
  }

  // ── Step 9: Create the Upload record ──────────────────────────────────
  const blobPath = `uploads/${event.id}/${streamResult.fileName}`;
  const upload = await prisma.upload.create({
    data: {
      eventId: event.id,
      fileName: streamResult.fileName,
      fileSize: BigInt(streamResult.fileSize),
      mimeType: streamResult.mimeType,
      blobPath,
      status: 'UPLOADED',
    },
  });

  // ── Step 10: Trigger transcoding ────────────────────────────────────────
  // Launch transcoder containers for each enabled codec (e.g. H.264, AV1).
  // Fire-and-forget — we return 202 immediately and the UI polls for progress.
  let transcodeResult = { launched: 0, failed: 0 };
  try {
    transcodeResult = await triggerTranscoding(upload.id, event.id);
  } catch (err) {
    console.error('[upload] Failed to trigger transcoding:', err);
  }

  // ── Step 11: Return 202 Accepted ──────────────────────────────────────
  const freshUpload = await prisma.upload.findUnique({
    where: { id: upload.id },
    select: { status: true },
  });

  return NextResponse.json(
    {
      data: {
        uploadId: upload.id,
        status: freshUpload?.status ?? upload.status,
        fileName: streamResult.fileName,
        fileSize: streamResult.fileSize.toString(),
        transcodingLaunched: transcodeResult.launched,
        transcodingFailed: transcodeResult.failed,
      },
    },
    { status: 202 },
  );
}

// =========================================================================
// Creator Upload Delete — DELETE /api/creator/events/:id/upload
// =========================================================================
// Deletes an upload and its associated resources (files on disk, transcode
// job records). The creator can use this to remove
// an uploaded file and start fresh, or to clean up after a failed upload.
//
// Auth: Creator session cookie (must own the event's channel).
//
// Preconditions:
//   - The event must exist and belong to the creator's channel
//   - An upload must exist for this event
//   - The upload must NOT be in UPLOADING or TRANSCODING state (those are
//     in-progress operations that shouldn't be interrupted — returns 409)
//
// Cleanup steps:
//   1. Delete the uploaded file from disk
//   2. Try to remove the now-empty upload directory
//   3. Delete the Upload record from the database (cascade deletes jobs)
//
// Response: { data: { deleted: true } }
// =========================================================================
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  // ── Step 1: Authenticate ──────────────────────────────────────────────
  // Only logged-in creators may delete uploads. requireCreator() checks the
  // session cookie and returns { creatorId, channelId } or null.
  const session = await requireCreator();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Step 2: Extract event ID from URL path ────────────────────────────
  // Next.js 14+ delivers dynamic route params as a Promise, so we await it.
  const { id } = await params;

  // ── Step 3: Verify event ownership ────────────────────────────────────
  // Scope the query to the creator's own channel so they can't delete
  // uploads belonging to other channels. We intentionally don't reveal
  // whether the event exists for another channel (returns 404 either way).
  const event = await prisma.event.findFirst({
    where: { id, channelId: session.channelId },
    select: { id: true },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  // ── Step 4: Fetch the upload ────────────────────────────────────────
  // We need the upload record to know the filename (for disk cleanup).
  const upload = await prisma.upload.findUnique({
    where: { eventId: event.id },
  });

  // If no upload exists for this event, there's nothing to delete.
  if (!upload) {
    return NextResponse.json({ error: 'No upload found for this event' }, { status: 404 });
  }

  // ── Step 5: Block deletion of in-progress uploads ─────────────────────
  // Uploads in UPLOADING or TRANSCODING state are actively being processed.
  // Deleting mid-operation could corrupt data or leave orphaned resources.
  // The creator should wait for the operation to finish (or fail) first.
  if (upload.status === 'UPLOADING' || upload.status === 'TRANSCODING') {
    return NextResponse.json(
      { error: 'Cannot delete an upload that is currently in progress. Wait for it to finish or fail.' },
      { status: 409 },
    );
  }

  // ── Step 6: Delete the uploaded file from disk ────────────────────────
  // The file lives at uploads/{eventId}/{fileName}. We use unlink() to
  // remove it. If the file is already gone (ENOENT), we ignore the error
  // — it may have been manually cleaned up or the upload failed before
  // the file was fully written.
  try {
    const filePath = path.join(process.cwd(), 'uploads', event.id, upload.fileName);
    await unlink(filePath);
  } catch (err: unknown) {
    // ENOENT means "file not found" — that's fine, nothing to delete.
    // Any other error (permissions, etc.) we log but don't fail on.
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to delete upload file for event ${event.id}:`, err);
    }
  }

  // ── Step 7: Try to remove the event's upload directory ────────────────
  // After deleting the file, the directory may be empty. rmdir() only
  // succeeds on empty directories, so if there are other files (unlikely
  // but possible), it will fail silently — which is exactly what we want.
  try {
    const uploadDir = path.join(process.cwd(), 'uploads', event.id);
    await rmdir(uploadDir);
  } catch {
    // Ignore all errors — the directory might not be empty, might not
    // exist, or we might not have permissions. All are acceptable.
  }

  // ── Step 8: Delete the Upload record from the database ────────────────
  // The Prisma schema has `onDelete: Cascade` on the TranscodeJob →
  // Upload relation, so deleting the Upload automatically deletes all
  // associated TranscodeJob records. No manual job deletion needed.
  await prisma.upload.delete({ where: { id: upload.id } });

  // ── Step 9: Return success ───────────────────────────────────────────
  return NextResponse.json({ data: { deleted: true } });
}
