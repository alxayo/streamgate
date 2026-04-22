import type { ServerConfig } from '../config.js';

export class UpstreamProxy {
  constructor(private readonly config: ServerConfig) {}

  /**
   * Construct the upstream URL for a given event and filename.
   * Convention: UPSTREAM_ORIGIN/:eventId/:filename (PDR §6.3)
   */
  buildUpstreamUrl(eventId: string, filename: string): string {
    const dirName = this.config.streamKeyPrefix + eventId;
    return `${this.config.upstreamOrigin}/${dirName}/${filename}`;
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
}
