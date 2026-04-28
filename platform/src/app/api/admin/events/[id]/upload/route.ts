// =========================================================================
// Admin Upload Status — GET /api/admin/events/:id/upload
// =========================================================================
// Same data as the creator endpoint, but accessible to any admin with the
// "events:manage" permission. No channel-ownership check is needed because
// admins may inspect any event.
//
// Auth: Admin session cookie + events:manage permission.
//
// Response shape:
//   { data: { upload: UploadWithJobs | null } }
//   - null when no upload exists for this event yet
//   - Includes jobs[] array with per-codec status and progress
// =========================================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPermission } from '@/lib/require-permission';
import { getSystemDefaults } from '@/lib/stream-config';
import { ALLOWED_VIDEO_MIME_TYPES } from '@streaming/shared';
import { mkdir, writeFile, unlink, rmdir } from 'fs/promises';
import path from 'path';

// Next.js 14+ dynamic route params are delivered as a Promise
interface RouteParams {
  params: Promise<{ id: string }>;
}

// ── GET handler ─────────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteParams) {
  // 1. Authenticate — requires admin session with events:manage permission.
  //    checkPermission returns a NextResponse (401/403) when denied, or null
  //    when the caller is authorised.
  const denied = await checkPermission('events:view');
  if (denied) return denied;

  // 2. Extract the event ID from the URL path
  const { id } = await params;

  // 3. Look up the event — admins can access any event, so no channel filter.
  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!event) {
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

// ── POST handler — Admin upload a video file for VOD transcoding ────────
// Mirrors the creator upload endpoint, but uses admin permission instead
// of channel-ownership checks. This lets admins upload files to any event.
//
// Accepts: multipart/form-data with a single "file" field.
// Returns: 202 Accepted with upload metadata on success.
// ─────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  // ── Step 1: Authenticate ──────────────────────────────────────────────
  // Require admin session with the "events:manage" permission. Unlike the
  // creator endpoint, no channel-ownership check is needed because admins
  // can manage any event in the system.
  const denied = await checkPermission('events:edit');
  if (denied) return denied;

  // ── Step 2: Extract event ID from URL path ────────────────────────────
  // Next.js 14+ delivers dynamic route params as a Promise, so we await it.
  const { id } = await params;

  // ── Step 3: Look up the event ─────────────────────────────────────────
  // Admins can upload to any event — no channel filter needed. We also
  // select streamType to verify this is a VOD event (LIVE events use RTMP
  // ingest, not file uploads).
  const event = await prisma.event.findUnique({
    where: { id },
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
  // If there's an existing upload in READY or FAILED state, the admin is
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
    // If the file write fails, mark the upload as FAILED so the admin
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
  // admin UI can poll the GET endpoint for transcoding progress.
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

// ── DELETE handler — Admin delete an upload and its associated files ─────
// Removes the upload record, cleans up any ACI containers from transcode
// jobs, and deletes the uploaded file from disk. This lets admins clean up
// uploads that are in a terminal state (READY, FAILED, or UPLOADED).
//
// Returns: { data: { deleted: true } } on success.
// ─────────────────────────────────────────────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  // ── Step 1: Authenticate ──────────────────────────────────────────────
  // Require admin session with "events:manage" permission. No channel
  // ownership check — admins can delete uploads for any event.
  const denied = await checkPermission('events:edit');
  if (denied) return denied;

  // ── Step 2: Extract event ID from URL path ────────────────────────────
  const { id } = await params;

  // ── Step 3: Look up the upload for this event ─────────────────────────
  // ── Step 3: Look up the upload for this event ─────────────────────────
  // We need the full upload record to know which file to delete from disk.
  const upload = await prisma.upload.findUnique({
    where: { eventId: id },
  });

  if (!upload) {
    return NextResponse.json({ error: 'No upload found for this event' }, { status: 404 });
  }

  // ── Step 4: Validate that the upload is in a deletable state ──────────
  // Only uploads in terminal or idle states can be deleted. If an upload
  // is actively being uploaded or transcoded, deleting it could corrupt
  // the process. The allowed states are:
  //   - READY: transcoding completed successfully
  //   - FAILED: transcoding failed
  //   - UPLOADED: file saved but transcoding hasn't started yet
  const deletableStatuses = ['READY', 'FAILED', 'UPLOADED'];
  if (!deletableStatuses.includes(upload.status)) {
    return NextResponse.json(
      { error: `Cannot delete upload in "${upload.status}" state. Must be READY, FAILED, or UPLOADED.` },
      { status: 409 },
    );
  }

  // ── Step 5: Delete the uploaded file from disk ────────────────────────
  // The file lives at uploads/{eventId}/{fileName}. We try to remove the
  // file and then the directory. If either fails (e.g., file already
  // deleted), we log the error but continue with the DB cleanup.
  try {
    const uploadDir = path.join(process.cwd(), 'uploads', id);
    const filePath = path.join(uploadDir, upload.fileName);
    await unlink(filePath);

    // Try to remove the event's upload directory if it's now empty.
    // rmdir will fail if the directory is not empty, which is fine.
    try {
      await rmdir(uploadDir);
    } catch {
      // Directory not empty or already gone — that's okay
    }
  } catch (err) {
    // File might already be deleted — log but continue with DB cleanup
    console.error(`[admin-upload-delete] Failed to delete file from disk:`, err);
  }

  // ── Step 6: Delete the upload record from the database ────────────────
  // This also cascade-deletes associated TranscodeJob records (thanks to
  // the onDelete: Cascade relation in the Prisma schema).
  await prisma.upload.delete({ where: { id: upload.id } });

  // ── Step 7: Return success ────────────────────────────────────────────
  return NextResponse.json({ data: { deleted: true } });
}
