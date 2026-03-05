import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { resolveSecurePath } from '../utils/path-safety.js';

export class ContentResolver {
  constructor(private readonly config: ServerConfig) {}

  /**
   * Attempt to resolve a content file from local storage.
   * Returns the absolute file path if found, null otherwise.
   */
  async resolveLocal(eventId: string, filename: string): Promise<string | null> {
    if (!this.config.streamRoot) return null;

    const filePath = resolveSecurePath(this.config.streamRoot, path.join(eventId, filename));
    if (!filePath) return null;

    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      return null;
    }
  }

  /**
   * Attempt to resolve from the segment cache.
   */
  async resolveCache(eventId: string, filename: string): Promise<string | null> {
    if (!this.config.segmentCacheRoot) return null;

    const filePath = resolveSecurePath(
      this.config.segmentCacheRoot,
      path.join(eventId, filename),
    );
    if (!filePath) return null;

    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      return null;
    }
  }

  /** Get the content mode based on config. */
  get mode(): 'local' | 'proxy' | 'hybrid' {
    if (this.config.streamRoot && this.config.upstreamOrigin) return 'hybrid';
    if (this.config.streamRoot) return 'local';
    return 'proxy';
  }
}
