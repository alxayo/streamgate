import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from '../config.js';
import { resolveSecurePath } from '../utils/path-safety.js';

export class SegmentCache {
  constructor(private readonly config: ServerConfig) {}

  /**
   * Write a segment to the persistent cache (PDR §6.3).
   */
  async write(eventId: string, filename: string, data: Buffer): Promise<void> {
    if (!this.config.segmentCacheRoot) return;

    const dirPath = resolveSecurePath(this.config.segmentCacheRoot, eventId);
    if (!dirPath) return;

    await fs.mkdir(dirPath, { recursive: true });

    const filePath = path.join(dirPath, path.basename(filename));
    await fs.writeFile(filePath, data);

    // Queue async eviction check (does not block response — PDR §6.3)
    this.checkDiskUsage().catch((err) =>
      console.error('Cache eviction check failed:', err),
    );
  }

  /**
   * Check cache size and perform LRU eviction if needed (PDR §6.3).
   */
  private async checkDiskUsage(): Promise<void> {
    if (!this.config.segmentCacheRoot) return;

    const maxBytes = this.config.segmentCacheMaxSizeGb * 1024 * 1024 * 1024;
    let totalSize = 0;
    const files: Array<{ path: string; atimeMs: number; size: number }> = [];

    try {
      await this.walkDir(this.config.segmentCacheRoot, files);
    } catch {
      return;
    }

    for (const file of files) {
      totalSize += file.size;
    }

    if (totalSize <= maxBytes) return;

    // Sort by access time ascending (LRU first)
    files.sort((a, b) => a.atimeMs - b.atimeMs);

    for (const file of files) {
      if (totalSize <= maxBytes) break;
      try {
        await fs.unlink(file.path);
        totalSize -= file.size;
      } catch {
        // File may have been removed already
      }
    }
  }

  private async walkDir(
    dir: string,
    results: Array<{ path: string; atimeMs: number; size: number }>,
  ): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(fullPath, results);
      } else {
        const stat = await fs.stat(fullPath);
        results.push({ path: fullPath, atimeMs: stat.atimeMs, size: stat.size });
      }
    }
  }

  /**
   * Delete all cached segments for a specific event.
   */
  async clearEvent(eventId: string): Promise<void> {
    if (!this.config.segmentCacheRoot) return;

    const dirPath = resolveSecurePath(this.config.segmentCacheRoot, eventId);
    if (!dirPath) return;

    await fs.rm(dirPath, { recursive: true, force: true });
  }

  /**
   * Get cache statistics for health endpoint.
   */
  async getStats(): Promise<{ eventCount: number; sizeMB: number }> {
    if (!this.config.segmentCacheRoot) {
      return { eventCount: 0, sizeMB: 0 };
    }

    try {
      const entries = await fs.readdir(this.config.segmentCacheRoot, { withFileTypes: true });
      const eventDirs = entries.filter((e) => e.isDirectory());

      let totalSize = 0;
      const files: Array<{ path: string; atimeMs: number; size: number }> = [];
      await this.walkDir(this.config.segmentCacheRoot, files);
      for (const file of files) {
        totalSize += file.size;
      }

      return {
        eventCount: eventDirs.length,
        sizeMB: Math.round(totalSize / (1024 * 1024)),
      };
    } catch {
      return { eventCount: 0, sizeMB: 0 };
    }
  }
}
