import type { ServerConfig } from '../config.js';

export class UpstreamProxy {
  constructor(private readonly config: ServerConfig) {}

  /**
   * Build a URL with the admin SAS token (for write/delete operations).
   * Falls back to the read-only SAS token if no admin token is configured.
   */
  private buildAdminUrl(blobPath: string): string {
    const baseUrl = `${this.config.upstreamOrigin}/${blobPath}`;
    const token = this.config.upstreamAdminSasToken || this.config.upstreamSasToken;
    if (token) {
      return `${baseUrl}?${token}`;
    }
    return baseUrl;
  }

  /**
   * Construct the upstream URL for a given event and filename.
   * Convention: UPSTREAM_ORIGIN/:eventId/:filename (PDR §6.3)
   */
  buildUpstreamUrl(eventId: string, filename: string): string {
    const dirName = this.config.streamKeyPrefix + eventId;
    const baseUrl = `${this.config.upstreamOrigin}/${dirName}/${filename}`;
    if (this.config.upstreamSasToken) {
      return `${baseUrl}?${this.config.upstreamSasToken}`;
    }
    return baseUrl;
  }

  /**
   * Fetch a file from the upstream origin.
   * Returns the response buffer and relevant headers.
   */
  async fetch(
    eventId: string,
    filename: string,
  ): Promise<{
    data: Buffer;
    contentType: string;
    lastModified?: string;
    etag?: string;
  }> {
    const url = this.buildUpstreamUrl(eventId, filename);
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    return {
      data,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      lastModified: response.headers.get('last-modified') || undefined,
      etag: response.headers.get('etag') || undefined,
    };
  }

  /**
   * Fetch a segment from upstream with retry on 404.
   * Live HLS segments may appear in the playlist before the blob sidecar
   * has finished uploading them to storage. Retrying with a short delay
   * bridges this race window without client-visible errors.
   */
  async fetchWithRetry(
    eventId: string,
    filename: string,
    maxRetries = 4,
    retryDelayMs = 800,
  ): Promise<{
    data: Buffer;
    contentType: string;
    lastModified?: string;
    etag?: string;
  }> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.fetch(eventId, filename);
      } catch (error) {
        lastError = error as Error;
        const is404 = lastError.message.includes('404');
        if (!is404 || attempt === maxRetries) {
          throw lastError;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    throw lastError;
  }

  /**
   * List all blobs under a given prefix in the upstream blob container.
   * Uses Azure Blob Storage REST API: List Blobs (flat listing).
   * Requires admin SAS token with list permission.
   */
  async listBlobs(eventId: string, subdir?: string): Promise<string[]> {
    if (!this.config.upstreamOrigin) {
      throw new Error('No upstream origin configured');
    }

    const dirName = this.config.streamKeyPrefix + eventId;
    const prefix = subdir ? `${dirName}/${subdir}/` : `${dirName}/`;

    // Parse container URL to build List Blobs request
    // UPSTREAM_ORIGIN format: https://<account>.blob.core.windows.net/<container>
    const originUrl = new URL(this.config.upstreamOrigin);
    const pathParts = originUrl.pathname.split('/').filter(Boolean);
    const container = pathParts[0] || '';
    const listUrl = `${originUrl.origin}/${container}?restype=container&comp=list&prefix=${encodeURIComponent(prefix)}`;
    const token = this.config.upstreamAdminSasToken || this.config.upstreamSasToken;
    const url = token ? `${listUrl}&${token}` : listUrl;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`List blobs returned ${response.status}`);
    }

    const xml = await response.text();
    // Simple XML parse — extract <Name>...</Name> from <Blob> elements
    const names: string[] = [];
    const blobRegex = /<Name>([^<]+)<\/Name>/g;
    let match: RegExpExecArray | null;
    while ((match = blobRegex.exec(xml)) !== null) {
      names.push(match[1]!);
    }
    return names;
  }

  /**
   * Delete all blobs for an event from upstream blob storage.
   * Lists all blobs under the event prefix, then deletes each one.
   * Returns the number of deleted blobs.
   */
  async deleteUpstreamBlobs(eventId: string): Promise<number> {
    let totalDeleted = 0;
    const maxPasses = 3;

    for (let pass = 0; pass < maxPasses; pass++) {
      const blobs = await this.listBlobs(eventId);
      if (blobs.length === 0) break;

      for (const blobName of blobs) {
        const url = this.buildAdminUrl(blobName);
        try {
          const response = await fetch(url, { method: 'DELETE' });
          if (response.ok || response.status === 404) {
            totalDeleted++;
          } else {
            console.error(`Failed to delete blob ${blobName}: ${response.status}`);
          }
        } catch (error) {
          console.error(`Failed to delete blob ${blobName}:`, error);
        }
      }

      if (pass < maxPasses - 1) {
        // Brief pause before re-listing to allow eventual consistency
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return totalDeleted;
  }

  /**
   * Upload (PUT) a blob to upstream storage.
   * Used by finalize to write updated playlists.
   */
  async putBlob(eventId: string, filename: string, data: string, contentType: string): Promise<void> {
    const dirName = this.config.streamKeyPrefix + eventId;
    const blobPath = `${dirName}/${filename}`;
    const url = this.buildAdminUrl(blobPath);

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'x-ms-blob-type': 'BlockBlob',
    };

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: data,
    });

    if (!response.ok) {
      throw new Error(`PUT blob ${blobPath} returned ${response.status}`);
    }
  }
}
