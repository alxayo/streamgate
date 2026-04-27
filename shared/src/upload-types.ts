/**
 * Upload & Transcoding Types
 * ==========================
 * These types define the data structures used to track video file uploads
 * and their transcoding into HLS streams. They are shared between:
 *   - Platform App (Next.js) — manages uploads, spawns transcoders, receives callbacks
 *   - File Transcoder containers (Go) — sends progress and completion callbacks
 *
 * The upload lifecycle:
 *   1. Creator uploads a video file → status: UPLOADING → UPLOADED
 *   2. Platform spawns one ACI container per codec → status: TRANSCODING
 *   3. Each container transcodes and calls back → individual TranscodeJobStatus
 *   4. When all codecs complete → status: READY (or FAILED if any codec fails)
 */

// ---------------------------------------------------------------------------
// Upload status — tracks the overall upload lifecycle
// ---------------------------------------------------------------------------

/**
 * The possible states of a video upload.
 * Progresses left-to-right; FAILED can occur at any step.
 *
 * UPLOADING    → File is being streamed from the browser to Azure Blob Storage
 * UPLOADED     → File is in blob storage, ready to be transcoded
 * TRANSCODING  → One or more codec containers are actively transcoding
 * READY        → All codec transcoding jobs completed successfully; VOD is playable
 * FAILED       → Something went wrong (check errorMessage for details)
 */
export type UploadStatus = 'UPLOADING' | 'UPLOADED' | 'TRANSCODING' | 'READY' | 'FAILED';

// ---------------------------------------------------------------------------
// Transcode job status — tracks a single codec's transcoding progress
// ---------------------------------------------------------------------------

/**
 * The possible states of an individual codec transcoding job.
 * Each upload spawns one job per enabled codec (e.g., H.264 + AV1 = 2 jobs).
 *
 * PENDING   → Job record created, ACI container not yet started
 * RUNNING   → ACI container is running FFmpeg
 * COMPLETED → Transcoding finished successfully, HLS segments uploaded to blob
 * FAILED    → Transcoding failed (container crashed, FFmpeg error, timeout, etc.)
 */
export type TranscodeJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

// ---------------------------------------------------------------------------
// Callback payloads — sent by the transcoder container back to Platform App
// ---------------------------------------------------------------------------

/**
 * Payload sent by a transcoder container when it finishes (success or failure).
 * Posted to: POST /api/internal/transcode-callback
 *
 * The Platform App uses this to:
 *   1. Update the TranscodeJob record in the database
 *   2. Clean up the ACI container
 *   3. Check if all codec jobs are done → generate master.m3u8 if so
 */
export interface TranscodeCallbackPayload {
  /** The TranscodeJob ID (matches the DB record) */
  jobId: string;
  /** Which codec this job was for */
  codec: string;
  /** Whether transcoding succeeded or failed */
  status: 'completed' | 'failed';
  /** Error message if status is 'failed' (human-readable) */
  error?: string;
  /** Video duration in seconds (only set on success) */
  duration?: number;
  /** List of variant playlist paths produced (e.g., ["stream_0/index.m3u8", "stream_1/index.m3u8"]) */
  variants?: string[];
}

/**
 * Payload sent by a transcoder container to report progress during transcoding.
 * Posted to: POST /api/internal/transcode-progress
 * Sent periodically (e.g., every 5 seconds) while FFmpeg is running.
 */
export interface TranscodeProgressPayload {
  /** The TranscodeJob ID */
  jobId: string;
  /** Which codec this progress is for */
  codec: string;
  /** Transcoding progress as a percentage (0-100) */
  progress: number;
}
