/**
 * Transcoder Progress Update API
 * ===============================
 * POST /api/internal/transcode-progress
 *
 * Called periodically by transcoder containers to report FFmpeg progress.
 * Updates the TranscodeJob.progress field (0-100) so the creator UI
 * can show real-time per-codec progress bars.
 *
 * Auth: X-Internal-Api-Key header (service-to-service, not browser)
 *
 * Request body (TranscodeProgressPayload from @streaming/shared):
 *   { jobId, codec, progress: 0-100 }
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getConfigValue, CONFIG_KEYS } from '@/lib/system-config';
import type { TranscodeProgressPayload } from '@streaming/shared';

export async function POST(request: NextRequest) {
  // ---------------------------------------------------------------------------
  // 1. Authenticate — same pattern as all /api/internal/* routes.
  //    Reject requests without a valid X-Internal-Api-Key header.
  // ---------------------------------------------------------------------------
  const apiKey = request.headers.get('x-internal-api-key');
  const expectedKey = await getConfigValue(prisma, CONFIG_KEYS.INTERNAL_API_KEY);
  if (!expectedKey || apiKey !== expectedKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---------------------------------------------------------------------------
  // 2. Parse and validate the request body.
  //    The transcoder sends { jobId, codec, progress } periodically during
  //    FFmpeg encoding (e.g., every 5 seconds).
  // ---------------------------------------------------------------------------
  let body: TranscodeProgressPayload;
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

  // Validate progress is a number between 0 and 100 (inclusive).
  // The transcoder calculates this from FFmpeg's time output vs. total duration.
  if (
    typeof body.progress !== 'number' ||
    !Number.isFinite(body.progress) ||
    body.progress < 0 ||
    body.progress > 100
  ) {
    return NextResponse.json(
      { error: 'progress must be a number between 0 and 100' },
      { status: 400 },
    );
  }

  // ---------------------------------------------------------------------------
  // 3. Look up the TranscodeJob to make sure it exists.
  //    Return 404 for unknown job IDs — the container may have a stale reference.
  // ---------------------------------------------------------------------------
  const job = await prisma.transcodeJob.findUnique({
    where: { id: body.jobId },
  });

  if (!job) {
    return NextResponse.json({ error: 'TranscodeJob not found' }, { status: 404 });
  }

  // ---------------------------------------------------------------------------
  // 4. Ignore progress updates for jobs that are already finished.
  //    This can happen if a progress report arrives after the completion callback
  //    due to network ordering. Just acknowledge without updating.
  // ---------------------------------------------------------------------------
  if (job.status === 'COMPLETED' || job.status === 'FAILED') {
    return NextResponse.json({ data: { acknowledged: true } });
  }

  // ---------------------------------------------------------------------------
  // 5. Update the job's progress field.
  //    The value is an integer 0-100 displayed as a percentage in the creator UI.
  //    We round to the nearest integer to keep the DB column clean.
  // ---------------------------------------------------------------------------
  await prisma.transcodeJob.update({
    where: { id: body.jobId },
    data: { progress: Math.round(body.progress) },
  });

  // ---------------------------------------------------------------------------
  // 6. Return acknowledgement.
  // ---------------------------------------------------------------------------
  return NextResponse.json({ data: { acknowledged: true } });
}
