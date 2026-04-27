/**
 * Transcoder Launcher — Ephemeral Container Management
 * =====================================================
 * This module manages the lifecycle of ephemeral transcoding containers.
 * When a creator uploads a video, we need to transcode it into HLS streams
 * for each enabled codec (H.264, AV1, VP8, VP9).
 *
 * Architecture:
 *   - Each codec gets its own container (they run in parallel)
 *   - Containers are ephemeral: start → transcode → callback → exit → delete
 *   - In production: Azure Container Instances (ACI) via @azure/arm-containerinstance
 *   - In development: docker run (local containers) or mock/skip
 *
 * What is ACI?
 *   Azure Container Instances is a serverless container service. You give it a
 *   Docker image + config and Azure runs it without you managing any VMs or
 *   clusters. Perfect for short-lived jobs like transcoding: you pay only for
 *   the seconds the container runs, and it cleans up automatically.
 *
 * Why ephemeral?
 *   Transcoding is a one-shot job: read the source video, produce HLS segments,
 *   upload them to blob storage, report success, and exit. There's no reason to
 *   keep the container running afterward. Ephemeral containers are cheaper and
 *   simpler than maintaining a long-running transcoding service.
 *
 * The launcher doesn't know about FFmpeg or HLS — it just starts containers
 * with the right environment variables and the transcoder image does the rest.
 *
 * Key environment variables the launcher reads:
 *   - TRANSCODER_IMAGE_H264, TRANSCODER_IMAGE_AV1, etc. — Docker image refs
 *   - AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP — for ACI management
 *   - TRANSCODER_CPU_CORES, TRANSCODER_MEMORY_GB — container resources
 *   - AZURE_STORAGE_CONNECTION_STRING — passed to containers for blob access
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
 * parallel as separate containers.
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
 * Result of launching a container — contains the resource identifier
 * needed to clean up the container later.
 */
export interface LaunchResult {
  /** Whether the container was launched successfully */
  success: boolean;
  /** Container resource identifier (ACI container group name, or docker container ID) */
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

// ============================================================================
// ACI Launcher (Production)
// ============================================================================

/**
 * Launch a transcoder container via Azure Container Instances.
 *
 * This function uses dynamic imports for the Azure SDK so that:
 *   1. The module can be imported even if the SDK packages aren't installed
 *   2. The large SDK code is only loaded when we actually create a container
 *
 * The ACI container group is configured as:
 *   - Restart policy: "Never" — run once and exit (ephemeral)
 *   - OS: Linux (the Go+FFmpeg image is Linux-based)
 *   - Resources: configurable CPU/memory via env vars (defaults: 4 cores, 8 GB)
 *   - Environment variables: all job config fields plus Azure credentials
 *
 * @param config - The transcoding job configuration
 * @returns LaunchResult with the ACI container group name or error
 */
async function launchACI(config: TranscodeJobConfig): Promise<LaunchResult> {
  // These env vars are required for ACI — checked before we get here, but
  // TypeScript doesn't know that so we assert them.
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID!;
  const resourceGroup = process.env.AZURE_RESOURCE_GROUP!;

  // Container group name must be DNS-compatible (lowercase, hyphens, max 63 chars).
  // We use a short prefix of the event ID to keep it readable in the Azure portal.
  const containerGroupName = `sg-transcode-${config.eventId.slice(0, 8)}-${config.codec}`;

  try {
    // Dynamic import — only loaded when actually creating ACI containers.
    // This means developers who don't have @azure/arm-containerinstance installed
    // (e.g., local dev without Azure) won't get import errors at startup.
    // Dynamic import — Azure SDK is intentionally not in package.json;
    // it fails gracefully at runtime if not installed.
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module may not be installed
    const { ContainerInstanceManagementClient } = await import('@azure/arm-containerinstance');
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — module may not be installed
    const { DefaultAzureCredential } = await import('@azure/identity');

    // DefaultAzureCredential tries multiple auth methods in order:
    //   1. Environment variables (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET)
    //   2. Managed Identity (when running in Azure)
    //   3. Azure CLI credentials (for local dev with `az login`)
    const credential = new DefaultAzureCredential();
    const client = new ContainerInstanceManagementClient(
      credential,
      subscriptionId,
    );

    const image = getTranscoderImage(config.codec);
    const cpuCores = parseFloat(process.env.TRANSCODER_CPU_CORES || '4');
    const memoryGB = parseFloat(process.env.TRANSCODER_MEMORY_GB || '8');

    // Build the list of environment variables to pass into the container.
    // The transcoder image reads these to know what to do.
    const environmentVariables = [
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
      // Pass Azure Storage connection string so the container can read the source
      // video and write HLS segments to blob storage.
      ...(process.env.AZURE_STORAGE_CONNECTION_STRING
        ? [
            {
              name: 'AZURE_STORAGE_CONNECTION_STRING',
              secureValue: process.env.AZURE_STORAGE_CONNECTION_STRING,
            },
          ]
        : []),
      // Pass the internal API key so the container can authenticate its callback
      // to the Platform App's completion endpoint.
      ...(process.env.INTERNAL_API_KEY
        ? [
            {
              name: 'INTERNAL_API_KEY',
              secureValue: process.env.INTERNAL_API_KEY,
            },
          ]
        : []),
    ];

    // Create the container group in Azure. This is an async operation — Azure
    // provisions the container and starts it. The beginCreateOrUpdate method
    // returns a poller that we await to get the final result.
    const poller = await client.containerGroups.beginCreateOrUpdate(
      resourceGroup,
      containerGroupName,
      {
        location: process.env.AZURE_LOCATION || 'eastus',
        osType: 'Linux',
        // "Never" means the container runs once and stays in "Terminated" state.
        // We clean it up later via a separate cleanup job or Azure policy.
        restartPolicy: 'Never',
        containers: [
          {
            name: containerGroupName,
            image,
            resources: {
              requests: {
                cpu: cpuCores,
                memoryInGB: memoryGB,
              },
            },
            environmentVariables,
          },
        ],
      },
    );

    // Wait for the container group to be created (not for the job to finish —
    // that happens asynchronously and the container calls back when done).
    await poller.pollUntilDone();

    console.log(
      `[transcoder-launcher] ACI container launched: ${containerGroupName} ` +
        `(image=${image}, cpu=${cpuCores}, mem=${memoryGB}GB)`,
    );

    return { success: true, containerId: containerGroupName };
  } catch (error) {
    // If the Azure SDK isn't installed, the dynamic import throws a MODULE_NOT_FOUND
    // error. We catch that and fall back to mock mode so local dev still works.
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

    // For any other error (auth failure, quota exceeded, etc.), report it
    console.error(
      `[transcoder-launcher] Failed to launch ACI container ${containerGroupName}:`,
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
 * Logs the job config and returns a fake container ID.
 *
 * This lets you develop and test the upload → transcode flow locally without
 * needing Azure credentials or a running ACI service. In the future, this
 * could be extended to run `docker run` locally for real transcoding tests.
 *
 * @param config - The transcoding job configuration
 * @returns LaunchResult with a mock container ID
 */
async function launchMock(config: TranscodeJobConfig): Promise<LaunchResult> {
  const mockId = `mock-${config.codec}-${config.jobId.slice(0, 8)}`;

  console.log(
    `[transcoder-launcher] MOCK MODE — would launch container for ` +
      `codec=${config.codec}, event=${config.eventId}, job=${config.jobId}`,
  );
  console.log(
    `[transcoder-launcher]   image: ${getTranscoderImage(config.codec)}`,
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
 * Launch a single ephemeral transcoder container for one codec.
 *
 * This is the main entry point for starting a transcoding job. It decides
 * whether to use Azure Container Instances (production) or mock mode (local
 * development) based on the presence of the AZURE_SUBSCRIPTION_ID env var.
 *
 * How it works:
 *   1. Check if AZURE_SUBSCRIPTION_ID is set → use ACI
 *   2. Otherwise → use mock mode (just log and return a fake ID)
 *   3. The ACI path also gracefully falls back to mock mode if the Azure SDK
 *      packages aren't installed (dynamic import failure)
 *
 * @param config - The transcoding job configuration
 * @returns LaunchResult with the container ID (for cleanup) or error
 */
export async function launchTranscoderContainer(
  config: TranscodeJobConfig,
): Promise<LaunchResult> {
  // If Azure credentials are configured, use ACI for real container creation.
  // The AZURE_SUBSCRIPTION_ID env var is the signal that we're in a production
  // (or staging) environment with Azure access.
  if (process.env.AZURE_SUBSCRIPTION_ID) {
    return launchACI(config);
  }

  // No Azure credentials — use mock mode for local development.
  return launchMock(config);
}

/**
 * Launch transcoder containers for all codecs in parallel.
 *
 * Given an array of job configs (one per codec), this starts all containers
 * simultaneously using Promise.allSettled. This means:
 *   - All codecs start transcoding at roughly the same time
 *   - If one codec's container fails to launch, the others still proceed
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
