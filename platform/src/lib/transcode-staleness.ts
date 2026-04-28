// =========================================================================
// Transcode Job Staleness Detection
// =========================================================================
// When a transcoder container crashes before sending a callback (e.g., a
// shell script syntax error, OOM kill, or missing dependency), the platform
// never receives the failure notification. The TranscodeJob stays in
// PENDING or RUNNING status forever, and the Upload stays in TRANSCODING.
//
// This module detects stale jobs by checking how long they've been in a
// non-terminal state. If a job exceeds the timeout (default: 30 minutes),
// it is automatically marked as FAILED so the UI reflects reality and the
// admin can retry.
//
// Called from the upload GET endpoint on every poll — this is safe because
// the check is a simple date comparison with no external API calls.
// =========================================================================

import { prisma } from '@/lib/prisma';

/**
 * Maximum time (in minutes) a transcode job can stay in PENDING or RUNNING
 * before it's considered stale. This should be shorter than the Container
 * Apps Job replicaTimeout (2 hours) because if the container hasn't sent
 * a progress callback within this window, something has gone wrong.
 *
 * Default: 30 minutes — generous enough for large files but catches crashes
 * quickly.  Can be overridden via TRANSCODE_STALE_TIMEOUT_MINUTES env var.
 */
const STALE_TIMEOUT_MINUTES = parseInt(
  process.env.TRANSCODE_STALE_TIMEOUT_MINUTES || '30',
  10,
);

/**
 * Checks all transcode jobs for a given upload and marks stale ones as FAILED.
 *
 * A job is considered stale if:
 *   - Its status is PENDING or RUNNING (non-terminal)
 *   - It was created more than STALE_TIMEOUT_MINUTES ago
 *
 * When all jobs for an upload have reached a terminal state (COMPLETED or
 * FAILED) and at least one has FAILED, the upload status is updated to FAILED.
 * If all completed successfully, it's updated to READY.
 *
 * @param uploadId - The upload whose jobs should be checked
 * @returns Number of jobs that were marked as stale-failed
 */
export async function checkAndMarkStaleJobs(uploadId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_TIMEOUT_MINUTES * 60 * 1000);

  // Find all non-terminal jobs older than the cutoff
  const staleJobs = await prisma.transcodeJob.findMany({
    where: {
      uploadId,
      status: { in: ['PENDING', 'RUNNING'] },
      createdAt: { lt: cutoff },
    },
    select: { id: true, codec: true },
  });

  if (staleJobs.length === 0) return 0;

  // Mark each stale job as FAILED with a descriptive error
  await prisma.transcodeJob.updateMany({
    where: {
      id: { in: staleJobs.map((j) => j.id) },
    },
    data: {
      status: 'FAILED',
      errorMessage: `Transcoder did not respond within ${STALE_TIMEOUT_MINUTES} minutes — the container likely crashed before it could report back. Check Container Apps Job logs for details.`,
      completedAt: new Date(),
    },
  });

  console.warn(
    `[transcode-staleness] Marked ${staleJobs.length} stale job(s) as FAILED for upload ${uploadId}: ${staleJobs.map((j) => j.codec).join(', ')}`,
  );

  // Now check if all jobs for this upload are in a terminal state.
  // If so, update the upload status accordingly.
  const allJobs = await prisma.transcodeJob.findMany({
    where: { uploadId },
    select: { status: true },
  });

  const allTerminal = allJobs.every(
    (j) => j.status === 'COMPLETED' || j.status === 'FAILED',
  );

  if (allTerminal && allJobs.length > 0) {
    const anyCompleted = allJobs.some((j) => j.status === 'COMPLETED');
    // If at least one codec completed successfully, mark as READY
    // (viewers can watch with whatever codecs succeeded).
    // If ALL failed, mark as FAILED.
    const newStatus = anyCompleted ? 'READY' : 'FAILED';

    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: newStatus,
        ...(newStatus === 'FAILED'
          ? { errorMessage: 'All transcoding jobs failed or timed out.' }
          : {}),
      },
    });

    console.warn(
      `[transcode-staleness] Upload ${uploadId} → ${newStatus} (all jobs terminal)`,
    );
  }

  return staleJobs.length;
}
