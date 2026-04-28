/**
 * blob-upload.ts — Uploads files to Azure Blob Storage.
 *
 * After a creator uploads a video file and it's saved to the platform's local
 * disk, this module streams it to Azure Blob Storage so that transcoder
 * containers (which can't access the platform's local disk) can download it.
 *
 * The blob is stored in the "vod-uploads" container with a path like:
 *   {eventId}/{filename}
 *
 * In local development (no AZURE_STORAGE_CONNECTION_STRING), this is a no-op
 * and the blobPath stays as-is (local path). Transcoding will run in mock
 * mode when no Azure credentials are available.
 */

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

// Name of the Azure Blob Storage container for VOD source uploads.
// Created via Bicep as a child resource of the storage account.
const VOD_UPLOADS_CONTAINER = 'vod-uploads';

/**
 * Result of a blob upload operation.
 * - `uploaded`: true if the file was actually uploaded to Azure Blob Storage.
 * - `blobName`: the blob name within the container (e.g., "{eventId}/{filename}").
 *   In dev mode (no Azure), this is the original local path.
 */
interface BlobUploadResult {
  uploaded: boolean;
  blobName: string;
}

/**
 * Uploads a local file to Azure Blob Storage.
 *
 * @param localFilePath - Full path to the file on the platform's local disk
 *                        (e.g., "/app/uploads/{eventId}/video.mp4")
 * @param eventId       - The UUID of the event this upload belongs to
 * @param fileName      - The original filename (e.g., "video.mp4")
 * @returns BlobUploadResult with the blob name and whether it was uploaded
 *
 * If AZURE_STORAGE_CONNECTION_STRING is not set, this returns immediately
 * without uploading — useful for local development where transcoding
 * runs in mock mode anyway.
 */
export async function uploadToBlob(
  localFilePath: string,
  eventId: string,
  fileName: string,
): Promise<BlobUploadResult> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

  // The blob name is always {eventId}/{filename}, regardless of where the
  // local file lives on disk. This is the path the transcoder will use
  // to download the source video from Azure Blob Storage.
  const blobName = `${eventId}/${fileName}`;

  // ── Dev mode: skip blob upload if no Azure credentials ──────────────
  // In local dev, there's no Azure Storage to upload to. The transcoder
  // launcher also runs in mock mode when Azure isn't configured, so
  // this is fine — the file stays on local disk only.
  if (!connectionString) {
    console.log(
      '[blob-upload] No AZURE_STORAGE_CONNECTION_STRING — skipping blob upload (dev mode)',
    );
    return { uploaded: false, blobName };
  }

  // ── Production: upload the file to Azure Blob Storage ───────────────
  // We dynamically import @azure/storage-blob to avoid loading the Azure
  // SDK in development environments where it's not needed.
  const { BlobServiceClient } = await import('@azure/storage-blob');

  const blobServiceClient =
    BlobServiceClient.fromConnectionString(connectionString);

  // Get a reference to the vod-uploads container. The container is
  // pre-created by Bicep — if it doesn't exist, the upload will fail
  // with a clear error.
  const containerClient =
    blobServiceClient.getContainerClient(VOD_UPLOADS_CONTAINER);

  // Get a reference to the specific blob we're uploading
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // Get the file size for the Content-Length header. Azure Blob Storage
  // needs this for block blob uploads.
  const fileStat = await stat(localFilePath);

  console.log(
    `[blob-upload] Uploading ${fileName} (${(fileStat.size / 1024 / 1024).toFixed(1)} MB) to ${VOD_UPLOADS_CONTAINER}/${blobName}`,
  );

  // Stream the file to blob storage. Using a ReadableStream avoids
  // loading the entire file into memory (important for multi-GB files).
  const fileStream = createReadStream(localFilePath);

  await blockBlobClient.uploadStream(
    fileStream,
    // Buffer size for each block (4 MB — Azure SDK default)
    4 * 1024 * 1024,
    // Max concurrent uploads (5 parallel block uploads)
    5,
    {
      blobHTTPHeaders: {
        // Set content type so Azure knows this is a video file
        blobContentType: 'application/octet-stream',
      },
    },
  );

  console.log(
    `[blob-upload] Successfully uploaded to ${VOD_UPLOADS_CONTAINER}/${blobName}`,
  );

  return { uploaded: true, blobName };
}

/**
 * Deletes a blob from Azure Blob Storage (best-effort).
 *
 * Used when an upload is deleted or replaced to clean up old source files.
 * Failures are logged but not thrown — blob cleanup is not critical.
 *
 * @param blobName - The blob name to delete (e.g., "{eventId}/{filename}")
 */
export async function deleteBlobIfExists(blobName: string): Promise<void> {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) return; // Dev mode — nothing to delete

  try {
    const { BlobServiceClient } = await import('@azure/storage-blob');
    const blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
    const containerClient =
      blobServiceClient.getContainerClient(VOD_UPLOADS_CONTAINER);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.deleteIfExists();
    console.log(`[blob-upload] Deleted blob ${VOD_UPLOADS_CONTAINER}/${blobName}`);
  } catch (err) {
    // Best-effort cleanup — log but don't throw
    console.error(`[blob-upload] Failed to delete blob ${blobName}:`, err);
  }
}
