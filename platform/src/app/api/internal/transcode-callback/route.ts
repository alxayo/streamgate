/**
 * Transcoder Completion Callback API
 * ===================================
 * POST /api/internal/transcode-callback
 *
 * Called by each Container Apps Job execution when it finishes transcoding
 * a video for one specific codec. Each codec job calls this independently —
 * so for an upload with 3 codecs enabled, this endpoint will be called
 * 3 times (once per codec).
 *
 * Auth: X-Internal-Api-Key header (service-to-service, not browser)
 *
 * What this endpoint does:
 *   1. Updates the TranscodeJob record (status → COMPLETED or FAILED)
 *   2. Checks if ALL jobs for this upload are now done
 *   3. If all done and all succeeded → sets Upload status to READY
 *   4. If all done and any failed → sets Upload status to FAILED
 *   5. If some still running → does nothing (waits for remaining callbacks)
 *
 * Note: No container cleanup needed — Azure Container Apps Jobs automatically
 * manages completed execution lifecycle (unlike raw ACI container groups).
 *
 * Request body (TranscodeCallbackPayload from @streaming/shared):
 *   { jobId, codec, status: 'completed'|'failed', error?, duration?, variants? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getConfigValue, CONFIG_KEYS } from '@/lib/system-config';
import type { TranscodeCallbackPayload } from '@streaming/shared';

export async function POST(request: NextRequest) {
  // ---------------------------------------------------------------------------
  // 1. Authenticate — only allow requests with a valid internal API key.
  //    This is the same pattern used by all /api/internal/* routes.
  //    The key is resolved via env var → DB fallback (see lib/system-config.ts).
  // ---------------------------------------------------------------------------
  const apiKey = request.headers.get('x-internal-api-key');
  const expectedKey = await getConfigValue(prisma, CONFIG_KEYS.INTERNAL_API_KEY);
  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---------------------------------------------------------------------------
  // 2. Parse and validate the request body.
  //    The transcoder container sends a JSON payload matching
  //    TranscodeCallbackPayload from the shared types package.
  // ---------------------------------------------------------------------------
  let body: TranscodeCallbackPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Validate required fields
  if (!body.jobId || typeof body.jobId !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid jobId' }, { status: 400 });
  }
  if (!body.codec || typeof body.codec !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid codec' }, { status: 400 });
  }
  if (body.status !== 'completed' && body.status !== 'failed') {
    return NextResponse.json(
      { error: 'status must be "completed" or "failed"' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Look up the TranscodeJob record in the database.
  //    Return 404 if it doesn't exist — the transcoder may have sent a stale
  //    callback for a job that was deleted (e.g., event was removed).
  // ---------------------------------------------------------------------------
  const job = await prisma.transcodeJob.findUnique({
    where: { id: body.jobId },
  });

  if (!job) {
    return NextResponse.json({ error: 'TranscodeJob not found' }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // 4. Handle duplicate callbacks gracefully.
  //    If the job is already in a terminal state (COMPLETED or FAILED), the
  //    transcoder may have retried after a network timeout. Just acknowledge
  //    without making any changes — idempotent by design.
  // ---------------------------------------------------------------------------
  if (job.status === 'COMPLETED' || job.status === 'FAILED') {
    return NextResponse.json({ data: { acknowledged: true } });
  }

  // ---------------------------------------------------------------------------
  // 5. Update the TranscodeJob record based on the callback status.
  //    - completed → COMPLETED with progress 100% and a completion timestamp
  //    - failed    → FAILED with the error message from the transcoder
  // ---------------------------------------------------------------------------
  if (body.status === 'completed') {
    await prisma.transcodeJob.update({
      where: { id: body.jobId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        progress: 100,
      },
    });
  } else {
    // status === 'failed'
    await prisma.transcodeJob.update({
      where: { id: body.jobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: body.error ?? 'Unknown transcoding error',
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Check if ALL transcode jobs for this upload are now done.
  //    An upload has one job per enabled codec (e.g., H.264 + AV1 = 2 jobs).
  //    We only update the parent Upload status when every job has finished.
  //
  //    - All COMPLETED → Upload becomes READY (VOD is fully playable)
  //    - Any FAILED    → Upload becomes FAILED (partial transcoding not usable)
  //    - Some still running → do nothing, wait for remaining callbacks
  // ---------------------------------------------------------------------------
  const allJobs = await prisma.transcodeJob.findMany({
    where: { uploadId: job.uploadId },
  });

  const allDone = allJobs.every(
    (j) => j.status === 'COMPLETED' || j.status === 'FAILED',
  );

  if (allDone) {
    const allSucceeded = allJobs.every((j) => j.status === 'COMPLETED');

    await prisma.upload.update({
      where: { id: job.uploadId },
      data: {
        status: allSucceeded ? 'READY' : 'FAILED',
        // Set duration from the callback if transcoding succeeded
        duration: body.duration ?? null,
        // Only set an error message if something failed
        ...(allSucceeded
          ? {}
          : { errorMessage: 'One or more codec transcoding jobs failed' }),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 7. Return acknowledgement — the transcoder uses this to confirm delivery.
  // ---------------------------------------------------------------------------
  return NextResponse.json({ data: { acknowledged: true } });
}
