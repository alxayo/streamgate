/**
 * Transcoder Launcher — Azure Container Apps Jobs
 * =================================================
 * This module starts VOD transcoding jobs using Azure Container Apps Jobs.
 * When a creator uploads a video, we transcode it into HLS streams for
 * each enabled codec (H.264, AV1, VP8, VP9).
 *
 * Architecture:
 *   - Each codec has a pre-created Container Apps Job definition in Azure
 *     (deployed via Bicep: sg-transcode-h264, sg-transcode-av1, etc.)
 *   - The job definitions live inside the same Container Apps Environment
 *     as the platform app and HLS server — sharing networking and logging
 *   - To transcode, we "start an execution" of the appropriate job,
 *     passing per-upload environment variables as template overrides
 *   - Azure manages the execution lifecycle: timeout, retry, cleanup
 *
 * What are Container Apps Jobs?
 *   Container Apps Jobs are purpose-built for short-lived tasks. Unlike
 *   Container Apps (which run continuously), Jobs run once and exit.
 *   The "Manual" trigger type means we start them on demand via the SDK.
 *   Azure automatically cleans up completed executions — no manual
 *   container deletion needed (unlike raw ACI container groups).
 *
 * Why Container Apps Jobs instead of ACI?
 *   - Same environment as platform + HLS → shared networking, secrets, logs
 *   - Built-in timeout (replicaTimeout) replaces manual cleanup cron
 *   - Built-in retry (replicaRetryLimit) for transient failures
 *   - Automatic execution history and cleanup
 *   - Faster cold-start (images pre-pulled in environment)
 *   - One SDK (@azure/arm-appcontainers) for everything
 *
 * Key environment variables the launcher reads:
 *   - TRANSCODER_IMAGE_H264, TRANSCODER_IMAGE_AV1, etc. — Docker image refs
 *   - AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP — for Azure API calls
 *   - TRANSCODER_CPU_CORES, TRANSCODER_MEMORY_GB — container resources
 */

import type { CodecName, VODRendition } from '@streaming/shared';

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for launching a single transcoding job.
 * One of these is created per codec when an upload triggers transcoding.
 *
 * For example, if an admin enables H.264 and AV1, uploading a video creates
 * two TranscodeJobConfig objects — one per codec — and both are launched in
 * parallel as separate Container Apps Job executions.
 */
export interface TranscodeJobConfig {
  /** Unique job ID (matches the TranscodeJob record in the database) */
  jobId: string;
  /** Event ID this upload belongs to */
  eventId: string;
  /** Which codec this job is for */
  codec: CodecName;
  /** Full URL to the raw video file in Azure Blob Storage */
  sourceBlobUrl: string;
  /** Blob path prefix where HLS output should be written (e.g., "{eventId}/{codec}/") */
  outputBlobPrefix: string;
  /** Rendition ladder for this codec (e.g., 1080p, 720p, 480p) */
  renditions: VODRendition[];
  /** Codec-specific FFmpeg settings (JSON string passed through to the container) */
  codecConfig: string;
  /** HLS segment duration in seconds (typically 4 for VOD) */
  hlsTime: number;
  /** Forced keyframe interval in seconds (should match hlsTime for clean cuts) */
  forceKeyFrameInterval: number;
  /** Platform App callback URL for completion notification */
  callbackUrl: string;
  /** Platform App callback URL for progress updates */
  progressUrl: string;
}

/**
 * Result of launching a transcoding job execution.
 * The containerId field stores the execution name for tracking/cancellation.
 */
export interface LaunchResult {
  /** Whether the job execution was started successfully */
  success: boolean;
  /** Job execution name (e.g., "sg-transcode-h264-abc123") — used for tracking */
  containerId?: string;
  /** Error message if launch failed */
  error?: string;
}

// ============================================================================
// Image Resolution
// ============================================================================

/**
 * Maps codec names to the environment variable suffix used for image refs.
 * The env var pattern is TRANSCODER_IMAGE_{SUFFIX}.
 */
const CODEC_IMAGE_ENV_SUFFIX: Record<CodecName, string> = {
  h264: 'H264',
  av1: 'AV1',
  vp8: 'VP8',
  vp9: 'VP9',
};

/**
 * Get the Docker image reference for a given codec's transcoder.
 *
 * Each codec has its own container image because they use different FFmpeg
 * compile flags and libraries. The image ref is read from an environment
 * variable named TRANSCODER_IMAGE_{CODEC}, e.g.:
 *   - TRANSCODER_IMAGE_H264=myregistry.azurecr.io/transcoder-h264:latest
 *   - TRANSCODER_IMAGE_AV1=myregistry.azurecr.io/transcoder-av1:latest
 *
 * Returns a placeholder string if the env var is not set. This allows the
 * module to load without errors in local dev where you might not have pushed
 * any transcoder images yet.
 *
 * @param codec - The codec to get the image for
 * @returns Docker image reference string
 */
export function getTranscoderImage(codec: CodecName): string {
  const suffix = CODEC_IMAGE_ENV_SUFFIX[codec];
  const envVar = `TRANSCODER_IMAGE_${suffix}`;
  return process.env[envVar] || `streamgate/transcoder-${codec}:latest`;
}

/**
 * Get the Container Apps Job name for a given codec.
 * These are pre-created in Azure via Bicep (e.g., "sg-transcode-h264").
 *
 * @param codec - The codec name
 * @returns The job name as defined in the Bicep template
 */
export function getJobName(codec: CodecName): string {
  return `sg-transcode-${codec}`;
}

// ============================================================================
// Container Apps Jobs Launcher (Production)
// ============================================================================

/**
 * Build the environment variables array for a transcoding job execution.
 *
 * These are passed as template overrides when starting a job execution.
 * Important: When overriding a Container Apps Job template, the ENTIRE
 * template is replaced. So we must include all env vars the container needs,
 * including secretRef entries for secrets defined on the job definition.
 *
 * @param config - The transcoding job configuration
 * @returns Array of environment variable objects
 */
function buildEnvVars(
  config: TranscodeJobConfig,
): Array<{ name: string; value?: string; secretRef?: string }> {
  return [
    // Per-execution variables — unique to each transcoding request
    { name: 'JOB_ID', value: config.jobId },
    { name: 'EVENT_ID', value: config.eventId },
    { name: 'CODEC', value: config.codec },
    { name: 'SOURCE_BLOB_URL', value: config.sourceBlobUrl },
    { name: 'OUTPUT_BLOB_PREFIX', value: config.outputBlobPrefix },
    { name: 'RENDITIONS', value: JSON.stringify(config.renditions) },
    { name: 'CODEC_CONFIG', value: config.codecConfig },
    { name: 'HLS_TIME', value: String(config.hlsTime) },
    { name: 'FORCE_KEYFRAME_INTERVAL', value: String(config.forceKeyFrameInterval) },
    { name: 'CALLBACK_URL', value: config.callbackUrl },
    { name: 'PROGRESS_URL', value: config.progressUrl },
    // Secrets — defined on the job definition in Bicep, referenced here via secretRef.
    // This is how Container Apps Jobs securely inject secrets into executions:
    // the secret value is stored encrypted at the job level, and the execution
    // template just references it by name.
    { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'azure-storage-connection-string' },
    { name: 'INTERNAL_API_KEY', secretRef: 'internal-api-key' },
  ];
}

/**
 * Launch a transcoder job execution via Azure Container Apps Jobs.
 *
 * This function starts a new execution of a pre-created Container Apps Job.
 * The job definition (image, resources, secrets, timeout, retry policy)
 * is managed in Bicep. We override the container template at execution time
 * to inject per-upload variables (job ID, source URL, renditions, etc.).
 *
 * How it works:
 *   1. Determine the job name from the codec (e.g., "sg-transcode-h264")
 *   2. Build a template override with all env vars the container needs
 *   3. Call jobs.beginStart() which creates a new execution
 *   4. Return the execution name for tracking in the database
 *
 * The execution runs asynchronously — it calls back to the platform when done.
 * Azure manages timeout (replicaTimeout) and retry (replicaRetryLimit).
 *
 * @param config - The transcoding job configuration
 * @returns LaunchResult with the execution name or error
 */
async function launchContainerAppsJob(config: TranscodeJobConfig): Promise<LaunchResult> {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!;
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!;
  const jobName = getJobName(config.codec as CodecName);

  try {
    // Dynamic import — Azure SDK is only loaded when actually starting jobs.
    // This means local dev without Azure SDK installed won't crash at import time.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module may not be installed in all environments
    const { ContainerAppsAPIClient } = await import('@azure/arm-appcontainers');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module may not be installed in all environments
    const { DefaultAzureCredential } = await import('@azure/identity');

    // DefaultAzureCredential tries multiple auth methods in order:
    //   1. Environment variables (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET)
    //   2. Managed Identity (when running in Azure)
    //   3. Azure CLI credentials (for local dev with `az login`)
    // For user-assigned managed identities (common in Container Apps), we must
    // pass the managedIdentityClientId — otherwise it tries system-assigned
    // identity and fails with "Unable to load the proper Managed Identity".
    const managedIdentityClientId = process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID;
    const credential = new DefaultAzureCredential(
      managedIdentityClientId ? { managedIdentityClientId } : undefined,
    );
    const client = new ContainerAppsAPIClient(credential, subscriptionId);

    const image = getTranscoderImage(config.codec as CodecName);
    const cpuCores = parseFloat(process.env.TRANSCODER_CPU_CORES || '4');
    const memoryGB = parseFloat(process.env.TRANSCODER_MEMORY_GB || '8');

    // Start a new execution of the pre-created job.
    // The template override replaces the entire container spec for this execution.
    // Secrets defined at the job level remain accessible via secretRef.
    const poller = await client.jobs.beginStart(resourceGroup, jobName, {
      template: {
        containers: [
          {
            name: `transcoder-${config.codec}`,
            image,
            resources: {
              cpu: cpuCores,
              memory: `${memoryGB}Gi`,
            },
            env: buildEnvVars(config),
          },
        ],
      },
    });

    // Wait for Azure to acknowledge the execution start (not for it to finish —
    // the transcoder runs asynchronously and calls back when done).
    const execution = await poller.pollUntilDone();

    console.log(
      `[transcoder-launcher] Container Apps Job execution started: ${execution.name} ` +
        `(job=${jobName}, image=${image}, cpu=${cpuCores}, mem=${memoryGB}Gi)`,
    );

    return { success: true, containerId: execution.name };
  } catch (error) {
    // If the Azure SDK isn't installed, the dynamic import throws MODULE_NOT_FOUND.
    // We catch that and fall back to mock mode so local dev still works.
    const err = error as Error & { code?: string };
    if (err.code === 'MODULE_NOT_FOUND' || err.message?.includes('Cannot find module')) {
      console.warn(
        '[transcoder-launcher] Azure SDK not available, using mock mode',
      );
      return {
        success: true,
        containerId: `mock-${config.codec}-${config.jobId.slice(0, 8)}`,
      };
    }

    // For any other error (auth failure, quota exceeded, job not found, etc.)
    console.error(
      `[transcoder-launcher] Failed to start job execution for ${jobName}:`,
      err.message,
    );
    return { success: false, error: err.message };
  }
}

// ============================================================================
// Mock Launcher (Development)
// ============================================================================

/**
 * Mock launcher used when Azure credentials are not configured.
 * Logs the job config and returns a fake execution name.
 *
 * This lets you develop and test the upload → transcode flow locally without
 * needing Azure credentials or Container Apps Jobs deployed. In the future,
 * this could be extended to run `docker run` locally for real transcoding.
 *
 * @param config - The transcoding job configuration
 * @returns LaunchResult with a mock execution name
 */
async function launchMock(config: TranscodeJobConfig): Promise<LaunchResult> {
  const mockId = `mock-${config.codec}-${config.jobId.slice(0, 8)}`;

  console.log(
    `[transcoder-launcher] MOCK MODE — would start job execution for ` +
      `codec=${config.codec}, event=${config.eventId}, job=${config.jobId}`,
  );
  console.log(
    `[transcoder-launcher]   job: ${getJobName(config.codec as CodecName)}`,
  );
  console.log(
    `[transcoder-launcher]   image: ${getTranscoderImage(config.codec as CodecName)}`,
  );
  console.log(
    `[transcoder-launcher]   source: ${config.sourceBlobUrl}`,
  );
  console.log(
    `[transcoder-launcher]   output: ${config.outputBlobPrefix}`,
  );
  console.log(
    `[transcoder-launcher]   renditions: ${config.renditions.map((r) => r.label).join(', ')}`,
  );

  return { success: true, containerId: mockId };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Launch a single transcoding job execution for one codec.
 *
 * This is the main entry point for starting a transcoding job. It decides
 * whether to use Azure Container Apps Jobs (production) or mock mode (local
 * development) based on the presence of the AZURE_SUBSCRIPTION_ID env var.
 *
 * How it works:
 *   1. Check if AZURE_SUBSCRIPTION_ID is set → use Container Apps Jobs
 *   2. Otherwise → use mock mode (just log and return a fake execution name)
 *   3. The Azure path also gracefully falls back to mock mode if the SDK
 *      packages aren't installed (dynamic import failure)
 *
 * @param config - The transcoding job configuration
 * @returns LaunchResult with the execution name (for tracking) or error
 */
export async function launchTranscoderContainer(
  config: TranscodeJobConfig,
): Promise<LaunchResult> {
  // If Azure credentials are configured, use Container Apps Jobs.
  // The AZURE_SUBSCRIPTION_ID env var is the signal that we're in a
  // production (or staging) environment with Azure access.
  if (process.env.AZURE_SUBSCRIPTION_ID) {
    return launchContainerAppsJob(config);
  }

  // No Azure credentials — use mock mode for local development.
  return launchMock(config);
}

/**
 * Launch transcoder job executions for all codecs in parallel.
 *
 * Given an array of job configs (one per codec), this starts all executions
 * simultaneously using Promise.allSettled. This means:
 *   - All codecs start transcoding at roughly the same time
 *   - If one codec's job fails to start, the others still proceed
 *   - The caller gets a complete picture of what succeeded and what failed
 *
 * Example usage:
 *   const configs = [h264Config, av1Config, vp9Config];
 *   const results = await launchAllTranscoders(configs);
 *   for (const [codec, result] of results) {
 *     if (!result.success) console.error(`${codec} failed: ${result.error}`);
 *   }
 *
 * @param configs - Array of job configs, one per codec to transcode
 * @returns Map of codec name → LaunchResult
 */
export async function launchAllTranscoders(
  configs: TranscodeJobConfig[],
): Promise<Map<string, LaunchResult>> {
  const results = new Map<string, LaunchResult>();

  // Promise.allSettled waits for ALL promises to complete, regardless of
  // whether they succeed or fail. This is important because we don't want
  // a failed H.264 launch to prevent AV1 from starting.
  const settled = await Promise.allSettled(
    configs.map((config) => launchTranscoderContainer(config)),
  );

  // Map each result back to its codec name
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const outcome = settled[i];

    if (outcome.status === 'fulfilled') {
      results.set(config.codec, outcome.value);
    } else {
      // This handles truly unexpected errors (e.g., runtime crashes).
      // Normal launch failures are already captured in LaunchResult.error.
      results.set(config.codec, {
        success: false,
        error: outcome.reason?.message || 'Unknown launch error',
      });
    }
  }

  return results;
}

/**
 * Stop a running job execution (cancellation).
 *
 * Can be used to cancel an in-progress transcoding job, e.g., when a creator
 * deletes an upload that's currently being transcoded. This calls the
 * Container Apps Jobs API to terminate the execution.
 *
 * In mock mode (local dev), this is a no-op.
 *
 * @param codec - The codec of the job to cancel
 * @param executionName - The execution name from the LaunchResult
 */
export async function stopJobExecution(
  codec: CodecName,
  executionName: string,
): Promise<void> {
  // Mock mode — nothing to stop
  if (!process.env.AZURE_SUBSCRIPTION_ID || executionName.startsWith('mock-')) {
    console.log(
      `[transcoder-launcher] MOCK MODE — would stop execution: ${executionName}`,
    );
    return;
  }

  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!;
  const jobName = getJobName(codec);

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module may not be installed
    const { ContainerAppsAPIClient } = await import('@azure/arm-appcontainers');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module may not be installed
    const { DefaultAzureCredential } = await import('@azure/identity');

    const managedIdentityClientId = process.env.AZURE_MANAGED_IDENTITY_CLIENT_ID;
    const client = new ContainerAppsAPIClient(
      new DefaultAzureCredential(
        managedIdentityClientId ? { managedIdentityClientId } : undefined,
      ),
      subscriptionId,
    );

    const poller = await client.jobs.beginStopExecution(
      resourceGroup,
      jobName,
      executionName,
    );
    await poller.pollUntilDone();

    console.log(
      `[transcoder-launcher] Stopped job execution: ${executionName} (job=${jobName})`,
    );
  } catch (error) {
    const err = error as Error;
    // Log but don't throw — stopping is best-effort
    console.error(
      `[transcoder-launcher] Failed to stop execution ${executionName}:`,
      err.message,
    );
  }
}
