import type { ServerConfig } from '../config.js';

export class UpstreamProxy {
  constructor(private readonly config: ServerConfig) {}

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
    maxRetries = 3,
    retryDelayMs = 500,
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
}
