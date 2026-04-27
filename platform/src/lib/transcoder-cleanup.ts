/**
 * Transcoder Cleanup — Ephemeral Container Teardown
 * ==================================================
 * This module handles cleanup of ephemeral Azure Container Instance (ACI)
 * containers after transcoding jobs complete or time out.
 *
 * Why do we need cleanup?
 *   When a video is transcoded, we spin up one ACI container per codec (see
 *   transcoder-launcher.ts). These containers are "fire and forget" — they
 *   run, call back with results, and exit. But even after exiting, the ACI
 *   container *group* resource still exists in Azure (in a "Terminated" state)
 *   and counts toward your subscription's resource limits. This module deletes
 *   those terminated container groups so they don't pile up.
 *
 * Two entry points call into this module:
 *   1. **transcode-callback endpoint** — after each job completes, it calls
 *      `cleanupCompletedJob()` to immediately delete that job's container.
 *   2. **Periodic cleanup** (cron or manual trigger) — calls
 *      `cleanupTimedOutJobs()` to find and clean up orphaned containers
 *      that never called back (crashed, stuck, network issues, etc.).
 *
 * The Azure SDK is dynamically imported (same pattern as transcoder-launcher.ts)
 * so this module works in local development without Azure credentials — it just
 * logs what it *would* do and returns.
 */

import { prisma } from '@/lib/prisma';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for transcoding jobs (in minutes). Jobs running longer than
 *  this are assumed to be stuck and will be marked as FAILED. */
const DEFAULT_TIMEOUT_MINUTES = 120;

/** Log prefix for all messages from this module */
const LOG_PREFIX = '[transcoder-cleanup]';

// ============================================================================
// ACI Container Deletion
// ============================================================================

/**
 * Delete a single ACI container group from Azure.
 *
 * After a transcoding container finishes (or times out), the container group
 * resource still exists in Azure. This function removes it to free up the
 * resource quota and keep the resource group tidy.
 *
 * How it works:
 *   1. Check if Azure credentials are configured (AZURE_SUBSCRIPTION_ID)
 *   2. If not → log and return (mock/local dev mode)
 *   3. If yes → dynamically import the Azure SDK and delete the container group
 *   4. If anything goes wrong → log the error but DON'T throw
 *
 * Why don't we throw on error?
 *   Cleanup failures should never crash the caller. The transcoding result has
 *   already been saved to the database — failing to delete the container is an
 *   operational nuisance (extra resources sitting around), not a data integrity
 *   issue. We log the error so operators can investigate and manually clean up.
 *
 * @param containerGroupName - The ACI container group name (e.g., "sg-transcode-abc12345-h264")
 */
export async function deleteContainerGroup(
  containerGroupName: string,
): Promise<void> {
  // ── Mock mode: no Azure credentials configured ──
  // In local development, AZURE_SUBSCRIPTION_ID won't be set. We just log
  // what we would have done and return. This mirrors the pattern in
  // transcoder-launcher.ts where mock mode is detected the same way.
  if (!process.env.AZURE_SUBSCRIPTION_ID) {
    console.log(
      `${LOG_PREFIX} MOCK MODE — would delete container group: ${containerGroupName}`,
    );
    return;
  }

  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP;

  if (!resourceGroup) {
    console.error(
      `${LOG_PREFIX} AZURE_RESOURCE_GROUP is not set — cannot delete container group: ${containerGroupName}`,
    );
    return;
  }

  try {
    // Dynamic import — the Azure SDK packages are intentionally NOT in
    // package.json. They're only installed in production/staging environments
    // that actually talk to Azure. This keeps the local dev experience lean.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module may not be installed
    const { ContainerInstanceManagementClient } = await import('@azure/arm-containerinstance');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module may not be installed
    const { DefaultAzureCredential } = await import('@azure/identity');

    // DefaultAzureCredential automatically picks the right auth method:
    //   - In Azure: Managed Identity
    //   - In CI: environment variables (service principal)
    //   - Locally: Azure CLI credentials (`az login`)
    const credential = new DefaultAzureCredential();
    const client = new ContainerInstanceManagementClient(
      credential,
      subscriptionId,
    );

    // beginDelete returns a poller — we await it to ensure the delete completes.
    // If the container group doesn't exist (already deleted), Azure returns 204
    // which the SDK handles gracefully (no error thrown).
    const poller = await client.containerGroups.beginDelete(
      resourceGroup,
      containerGroupName,
    );
    await poller.pollUntilDone();

    console.log(
      `${LOG_PREFIX} Deleted ACI container group: ${containerGroupName}`,
    );
  } catch (error) {
    // If the Azure SDK isn't installed, the dynamic import throws MODULE_NOT_FOUND.
    // This is expected in local dev and we handle it gracefully.
    const err = error as Error & { code?: string };
    if (err.code === 'MODULE_NOT_FOUND' || err.message?.includes('Cannot find module')) {
      console.warn(
        `${LOG_PREFIX} Azure SDK not available — skipping container deletion for: ${containerGroupName}`,
      );
      return;
    }

    // For any other error (auth failure, network issue, etc.), log it but
    // DON'T re-throw. Cleanup is best-effort — we don't want a transient
    // Azure API error to crash the callback handler or cron job.
    console.error(
      `${LOG_PREFIX} Failed to delete container group ${containerGroupName}:`,
      err.message,
    );
  }
}

// ============================================================================
// Single Job Cleanup
// ============================================================================

/**
 * Clean up the ACI container for a completed transcoding job.
 *
 * Called by the transcode-callback endpoint after a job reports completion
 * (success or failure). This function:
 *   1. Looks up the TranscodeJob by ID
 *   2. If it has an `aciContainerGroup` value → deletes the container in Azure
 *   3. Clears the `aciContainerGroup` field in the DB so we don't try to
 *      clean up the same container twice (idempotency)
 *
 * Why clear the field?
 *   If the callback endpoint is called twice (retry, duplicate webhook, etc.),
 *   the second call will see aciContainerGroup = null and skip deletion.
 *   This prevents wasted API calls and confusing "not found" errors.
 *
 * @param jobId - The TranscodeJob ID to clean up
 */
export async function cleanupCompletedJob(jobId: string): Promise<void> {
  // Look up the job to find its container group name
  const job = await prisma.transcodeJob.findUnique({
    where: { id: jobId },
    select: { id: true, aciContainerGroup: true },
  });

  if (!job) {
    console.warn(`${LOG_PREFIX} Job not found for cleanup: ${jobId}`);
    return;
  }

  // If the job has a container group, delete it from Azure
  if (job.aciContainerGroup) {
    await deleteContainerGroup(job.aciContainerGroup);

    // Clear the field in the DB so we don't attempt cleanup again.
    // This is done AFTER the delete call (not before) so that if the delete
    // fails, the field is still set and a future cleanup run can retry.
    await prisma.transcodeJob.update({
      where: { id: jobId },
      data: { aciContainerGroup: null },
    });

    console.log(
      `${LOG_PREFIX} Cleaned up container for job ${jobId}`,
    );
  } else {
    // No container group to clean up — this is normal for mock mode jobs
    // or jobs where cleanup already ran.
    console.log(
      `${LOG_PREFIX} No container group to clean up for job ${jobId}`,
    );
  }
}

// ============================================================================
// Timed-Out Job Cleanup (Bulk)
// ============================================================================

/**
 * Find and clean up transcoding jobs that have been running too long.
 *
 * Transcoding should complete within a predictable time window (depends on
 * video length and codec complexity, but 2 hours is a generous upper bound).
 * Jobs that exceed this timeout are likely stuck — the container crashed,
 * FFmpeg hung, or the callback never arrived.
 *
 * This function:
 *   1. Queries for all RUNNING or PENDING jobs older than the timeout
 *   2. Marks each as FAILED with a descriptive error message
 *   3. Deletes their ACI container groups (if set)
 *   4. Re-evaluates the parent Upload status:
 *      - If ALL jobs for that upload are done (COMPLETED or FAILED)
 *        and at least one is FAILED → marks the Upload as FAILED too
 *
 * Why re-evaluate the Upload?
 *   The Upload status is a rollup of its TranscodeJobs. Normally the callback
 *   endpoint updates the Upload when the last job completes. But if a job
 *   times out (no callback), the Upload would stay stuck in "TRANSCODING"
 *   forever. This function closes that gap.
 *
 * @param timeoutMinutes - How old a job must be to be considered timed out (default: 120)
 * @returns Object with `cleaned` — the number of jobs that were cleaned up
 */
export async function cleanupTimedOutJobs(
  timeoutMinutes: number = DEFAULT_TIMEOUT_MINUTES,
): Promise<{ cleaned: number }> {
  // Calculate the cutoff time: any job created before this is "timed out"
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  // Find all jobs that are still PENDING or RUNNING but older than the timeout.
  // These are stuck — they should have completed (or failed) by now.
  const timedOutJobs = await prisma.transcodeJob.findMany({
    where: {
      status: { in: ['RUNNING', 'PENDING'] },
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      uploadId: true,
      codec: true,
      aciContainerGroup: true,
      createdAt: true,
    },
  });

  if (timedOutJobs.length === 0) {
    console.log(`${LOG_PREFIX} No timed-out jobs found (timeout: ${timeoutMinutes}min)`);
    return { cleaned: 0 };
  }

  console.log(
    `${LOG_PREFIX} Found ${timedOutJobs.length} timed-out job(s) — cleaning up...`,
  );

  // Track which uploads are affected so we can re-evaluate their status later.
  // Using a Set because multiple jobs may belong to the same upload (one per codec).
  const affectedUploadIds = new Set<string>();

  // Process each timed-out job: mark as FAILED and delete its container
  for (const job of timedOutJobs) {
    // Mark the job as FAILED with a descriptive error message
    await prisma.transcodeJob.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        errorMessage: `Transcoding timed out after ${timeoutMinutes} minutes`,
        completedAt: new Date(),
        // Clear the container group reference (cleanup is happening now)
        aciContainerGroup: null,
      },
    });

    // Delete the ACI container group if one was created
    if (job.aciContainerGroup) {
      await deleteContainerGroup(job.aciContainerGroup);
    }

    console.log(
      `${LOG_PREFIX} Timed out job ${job.id} (codec=${job.codec}, ` +
        `created=${job.createdAt.toISOString()})`,
    );

    affectedUploadIds.add(job.uploadId);
  }

  // ── Re-evaluate parent Upload status ──
  // For each affected upload, check if ALL its jobs are now done.
  // If they are and at least one FAILED → mark the Upload as FAILED.
  for (const uploadId of affectedUploadIds) {
    await reevaluateUploadStatus(uploadId);
  }

  console.log(
    `${LOG_PREFIX} Cleanup complete: ${timedOutJobs.length} job(s) cleaned up`,
  );

  return { cleaned: timedOutJobs.length };
}

// ============================================================================
// Upload Status Re-evaluation
// ============================================================================

/**
 * Re-evaluate the overall status of an Upload based on its TranscodeJobs.
 *
 * An Upload's status is a rollup of its child TranscodeJobs:
 *   - If any job is still PENDING or RUNNING → Upload stays in TRANSCODING
 *   - If ALL jobs are done (COMPLETED or FAILED) and at least one FAILED → FAILED
 *   - If ALL jobs are COMPLETED → READY (but this case is handled by the
 *     callback endpoint, not here)
 *
 * This function only transitions the Upload to FAILED — the happy path
 * (all jobs COMPLETED → READY) is handled elsewhere to avoid race conditions
 * with the callback endpoint.
 *
 * @param uploadId - The Upload ID to re-evaluate
 */
async function reevaluateUploadStatus(uploadId: string): Promise<void> {
  // Fetch ALL jobs for this upload to see the full picture
  const jobs = await prisma.transcodeJob.findMany({
    where: { uploadId },
    select: { status: true },
  });

  if (jobs.length === 0) return;

  // Check if all jobs are in a terminal state (COMPLETED or FAILED)
  const allDone = jobs.every(
    (j) => j.status === 'COMPLETED' || j.status === 'FAILED',
  );

  // Check if at least one job failed
  const anyFailed = jobs.some((j) => j.status === 'FAILED');

  // If all jobs are done and at least one failed → mark the Upload as FAILED
  if (allDone && anyFailed) {
    await prisma.upload.update({
      where: { id: uploadId },
      data: {
        status: 'FAILED',
        errorMessage: 'One or more transcoding jobs failed',
      },
    });

    console.log(
      `${LOG_PREFIX} Upload ${uploadId} marked as FAILED (some jobs failed)`,
    );
  }
}
