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
import { ALLOWED_VIDEO_MIME_TYPES } from '@streaming/shared';
import { mkdir, writeFile } from 'fs/promises';
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

  // ── Step 6: Parse multipart form data ─────────────────────────────────
  // Next.js supports request.formData() natively — no external middleware
  // needed. We extract the single "file" field from the form data.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Invalid multipart form data' },
      { status: 400 },
    );
  }

  const file = formData.get('file');

  // The "file" field must be present and must be an actual File object
  // (not a plain string, which formData.get can also return for text fields).
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing "file" field in form data' },
      { status: 400 },
    );
  }

  // ── Step 7: Validate MIME type ────────────────────────────────────────
  // We only accept specific video container formats. The MIME type comes
  // from the browser's Content-Type for the file part.
  if (!(ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Allowed: ${ALLOWED_VIDEO_MIME_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  // ── Step 8: Validate file size against system settings ────────────────
  // The admin can configure the max upload size in System Settings.
  // getSystemDefaults() reads (or bootstraps) the setting from the DB.
  const { maxUploadSizeBytes } = await getSystemDefaults();

  if (BigInt(file.size) > maxUploadSizeBytes) {
    return NextResponse.json(
      { error: `File too large. Maximum allowed size is ${maxUploadSizeBytes.toString()} bytes` },
      { status: 400 },
    );
  }

  // ── Step 9: Sanitize the filename ─────────────────────────────────────
  // Strip path separators and restrict to safe characters to prevent
  // directory traversal and filesystem issues. Only alphanumeric, hyphens,
  // underscores, and dots are allowed. Anything else becomes an underscore.
  const rawName = file.name || 'upload.mp4';
  const sanitizedFileName = rawName
    .replace(/[/\\]/g, '')                     // Remove path separators first
    .replace(/[^a-zA-Z0-9._-]/g, '_');         // Replace unsafe chars with underscore

  // ── Step 10: Delete previous upload if re-uploading ───────────────────
  // If there's an existing upload in READY or FAILED state, the creator is
  // re-uploading. We delete the old record to make room for the new one.
  // (The eventId column has a @unique constraint, so we must delete first.)
  if (existingUpload && (existingUpload.status === 'READY' || existingUpload.status === 'FAILED')) {
    await prisma.upload.delete({ where: { id: existingUpload.id } });
  }

  // ── Step 11: Create the Upload record with UPLOADING status ───────────
  // We create the DB record before writing the file so we can track that
  // an upload is in progress. If the file write fails, we'll update the
  // status to FAILED.
  const blobPath = `uploads/${event.id}/${sanitizedFileName}`;
  const upload = await prisma.upload.create({
    data: {
      eventId: event.id,
      fileName: sanitizedFileName,
      fileSize: BigInt(file.size),
      mimeType: file.type,
      blobPath,
      status: 'UPLOADING',
    },
  });

  // ── Step 12: Save the file to disk ────────────────────────────────────
  // Create the directory if it doesn't exist (recursive: true creates any
  // missing parent directories). Then read the file into a Buffer and
  // write it to disk.
  try {
    const uploadDir = path.join(process.cwd(), 'uploads', event.id);
    await mkdir(uploadDir, { recursive: true });

    // Read the file contents into a Buffer and write to disk
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadDir, sanitizedFileName), buffer);
  } catch (err) {
    // If the file write fails, mark the upload as FAILED so the creator
    // can retry. We don't leave it stuck in UPLOADING state.
    await prisma.upload.update({
      where: { id: upload.id },
      data: {
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : 'File write failed',
      },
    });
    return NextResponse.json(
      { error: 'Failed to save uploaded file' },
      { status: 500 },
    );
  }

  // ── Step 13: Update status to UPLOADED ────────────────────────────────
  // The file is safely on disk. Update the record so downstream processes
  // (e.g. the transcoder) know it's ready to be picked up.
  await prisma.upload.update({
    where: { id: upload.id },
    data: { status: 'UPLOADED' },
  });

  // ── Step 14: Return 202 Accepted ──────────────────────────────────────
  // 202 signals that the upload has been accepted for processing. The
  // creator UI can poll the GET endpoint for transcoding progress.
  // BigInt fileSize must be converted to string for JSON serialisation.
  return NextResponse.json(
    {
      data: {
        uploadId: upload.id,
        status: 'UPLOADED',
        fileName: sanitizedFileName,
        fileSize: file.size.toString(),
      },
    },
    { status: 202 },
  );
}
