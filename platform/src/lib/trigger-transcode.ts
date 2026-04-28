/**
 * trigger-transcode.ts — Orchestrates launching transcoding jobs after a file upload.
 *
 * When a creator uploads a video file, the platform needs to transcode it into
 * multiple formats (codecs) and quality levels (renditions) so viewers can watch
 * via HLS adaptive bitrate streaming. This module:
 *
 * 1. Reads the system-wide transcoding settings (which codecs are enabled, what
 *    renditions/quality levels to produce)
 * 2. Creates a database record (TranscodeJob) for each codec so we can track progress
 * 3. Launches the actual transcoder containers (one per codec) via the transcoder-launcher
 * 4. Updates each job's status based on whether the container launched successfully
 *
 * This function is called from:
 * - The manual "transcode" API endpoint (creator clicks a button to start/retry)
 * - The upload API (auto-trigger after a successful upload) — wired up separately
 */

import { prisma } from '@/lib/prisma';
import { getSystemDefaults } from '@/lib/stream-config';
import {
  launchAllTranscoders,
  type TranscodeJobConfig,
} from '@/lib/transcoder-launcher';
import {
  DEFAULT_VOD_HLS_TIME,
  DEFAULT_VOD_KEYFRAME_INTERVAL,
  type CodecName,
  type VODRendition,
} from '@streaming/shared';

/**
 * Result returned after attempting to launch all transcoding jobs.
 * `launched` = jobs that started successfully, `failed` = jobs that couldn't start.
 */
interface TriggerResult {
  launched: number;
  failed: number;
}

/**
 * triggerTranscoding — Main entry point for starting transcoding of an uploaded video.
 *
 * @param uploadId - The database ID of the Upload record (the source video file)
 * @param eventId  - The database ID of the Event this upload belongs to
 * @returns An object with counts of successfully launched and failed jobs
 *
 * Flow:
 *   1. Read system settings → which codecs are enabled? what renditions per codec?
 *   2. Mark the Upload as TRANSCODING so the UI shows the right status
 *   3. Create one TranscodeJob DB record per enabled codec (e.g., h264, av1)
 *   4. Build config objects that tell each transcoder container what to do
 *   5. Launch all transcoder containers in parallel
 *   6. Update each TranscodeJob with the launch result (RUNNING or FAILED)
 */
export async function triggerTranscoding(
  uploadId: string,
  eventId: string,
): Promise<TriggerResult> {
  // ──────────────────────────────────────────────────────────────────────────
  // Step 1: Read system-wide transcoding settings
  // ──────────────────────────────────────────────────────────────────────────
  // `getSystemDefaults()` returns the global config from SystemSettings table.
  // It tells us which codecs are turned on (e.g., ["h264", "av1"]) and what
  // quality renditions to produce for each codec (e.g., 1080p, 720p, 480p).
  const systemDefaults = await getSystemDefaults();
  const { enabledCodecs, vodRenditions } = systemDefaults;

  // ──────────────────────────────────────────────────────────────────────────
  // Step 2: Mark the Upload as TRANSCODING
  // ──────────────────────────────────────────────────────────────────────────
  // This status change is important so the UI can show the creator that
  // transcoding is in progress (e.g., a spinner or progress bar).
  const upload = await prisma.upload.update({
    where: { id: uploadId },
    data: { status: 'TRANSCODING' },
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 3: Create a TranscodeJob record for each enabled codec
  // ──────────────────────────────────────────────────────────────────────────
  // We create DB records *before* launching containers so we have job IDs to
  // track. Each record starts as PENDING and gets updated to RUNNING or FAILED
  // after the container launch attempt.
  const jobs = await Promise.all(
    enabledCodecs.map((codec) =>
      prisma.transcodeJob.create({
        data: {
          uploadId,
          codec,
          status: 'PENDING',
        },
      }),
    ),
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Step 4: Build TranscodeJobConfig objects for each job
  // ──────────────────────────────────────────────────────────────────────────
  // Each config tells the transcoder container everything it needs to know:
  // - Where to find the source video (sourceBlobUrl)
  // - Where to write the output HLS segments (outputBlobPrefix)
  // - What quality levels to produce (renditions)
  // - How to report back progress and completion (callbackUrl, progressUrl)
  const baseUrl =
    process.env.PLATFORM_APP_URL || 'http://localhost:3000';

  const configs: TranscodeJobConfig[] = jobs.map((job) => {
    // Look up the renditions for this codec from system settings.
    // For example, h264 might have [1080p, 720p, 480p] renditions.
    const renditionsForCodec: VODRendition[] =
      vodRenditions[job.codec] ?? [];

    return {
      // Unique job ID — matches the DB record so callbacks can update the right row
      jobId: job.id,

      // Which event this transcoding is for
      eventId,

      // The codec to use (e.g., "h264", "av1", "vp9")
      codec: job.codec as CodecName,

      // Path to the source video file. For now this is the relative file path
      // stored in the Upload record. In production, this could be a blob storage URL.
      sourceBlobUrl: upload.blobPath,

      // Where transcoded HLS segments will be written.
      // Convention: {eventId}/{codec}/ → e.g., "abc123/h264/"
      outputBlobPrefix: `${eventId}/${job.codec}/`,

      // Quality levels to produce for this codec
      renditions: renditionsForCodec,

      // Codec-specific FFmpeg options — placeholder for now, can be customized later
      codecConfig: '{}',

      // HLS segment duration in seconds (each .ts file will be ~4 seconds long)
      hlsTime: DEFAULT_VOD_HLS_TIME,

      // Force a keyframe every N seconds — must match hlsTime for clean segment splits
      forceKeyFrameInterval: DEFAULT_VOD_KEYFRAME_INTERVAL,

      // URL the transcoder will POST to when it finishes (success or failure)
      callbackUrl: `${baseUrl}/api/internal/transcode-callback`,

      // URL the transcoder will POST to periodically to report progress (0-100%)
      progressUrl: `${baseUrl}/api/internal/transcode-progress`,
    };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Step 5: Launch all transcoder containers in parallel
  // ──────────────────────────────────────────────────────────────────────────
  // `launchAllTranscoders` sends a request to start one container per codec.
  // It returns a Map<jobId, LaunchResult> where each result tells us whether
  // the container started successfully and its container ID.
  const results = await launchAllTranscoders(configs);

  // ──────────────────────────────────────────────────────────────────────────
  // Step 6: Update each TranscodeJob based on the launch result
  // ──────────────────────────────────────────────────────────────────────────
  // For each job, check if the container launched OK:
  // - Success → mark as RUNNING with the container ID and start time
  // - Failure → mark as FAILED with the error message
  let launched = 0;
  let failed = 0;

  await Promise.all(
    jobs.map(async (job) => {
      // The results map is keyed by codec name (e.g., "h264"), not job ID.
      const result = results.get(job.codec);

      if (result?.success) {
        // Container started successfully — update the job to RUNNING
        await prisma.transcodeJob.update({
          where: { id: job.id },
          data: {
            status: 'RUNNING',
            startedAt: new Date(),
            // Store the job execution name so we can track or cancel it later
            executionName: result.containerId ?? null,
          },
        });
        launched++;
      } else {
        // Container failed to start — mark the job as FAILED with the error
        await prisma.transcodeJob.update({
          where: { id: job.id },
          data: {
            status: 'FAILED',
            errorMessage:
              result?.error ?? 'Unknown launch failure',
          },
        });
        failed++;
      }
    }),
  );

  return { launched, failed };
}
