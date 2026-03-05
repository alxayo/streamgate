import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from '../config.js';

/**
 * Periodic cache cleanup service (PDR §6.3).
 * Runs every 6 hours (configurable), removes segments older than maxAge,
 * and performs LRU eviction if cache exceeds size limit.
 */
export class CacheCleanupService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly config: ServerConfig;
  private readonly cleanupIntervalMs = 6 * 60 * 60 * 1000; // 6 hours

  constructor(config: ServerConfig) {
    this.config = config;
  }

  start(): void {
    if (!this.config.segmentCacheRoot) return;

    // Run initial cleanup after a brief delay
    setTimeout(() => this.cleanup(), 60_000);
    this.intervalId = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async cleanup(): Promise<void> {
    if (!this.config.segmentCacheRoot) return;

    try {
      const files = await this.walkDir(this.config.segmentCacheRoot);

      // Phase 1: Age-based cleanup
      const maxAgeMs = this.config.segmentCacheMaxAgeHours * 60 * 60 * 1000;
      const now = Date.now();
      let removedCount = 0;

      for (const file of files) {
        if (now - file.mtimeMs > maxAgeMs) {
          try {
            await fs.unlink(file.path);
            removedCount++;
          } catch {
            // File may have been removed by another process
          }
        }
      }

      // Phase 2: Size-based LRU eviction
      const remainingFiles = await this.walkDir(this.config.segmentCacheRoot);
      let totalSize = remainingFiles.reduce((sum, f) => sum + f.size, 0);
      const maxBytes = this.config.segmentCacheMaxSizeGb * 1024 * 1024 * 1024;

      if (totalSize > maxBytes) {
        // Sort by access time ascending (LRU first)
        remainingFiles.sort((a, b) => a.atimeMs - b.atimeMs);

        for (const file of remainingFiles) {
          if (totalSize <= maxBytes) break;
          try {
            await fs.unlink(file.path);
            totalSize -= file.size;
            removedCount++;
          } catch {
            // Skip
          }
        }
      }

      if (removedCount > 0) {
        console.log(`Cache cleanup: removed ${removedCount} files`);
      }

      // Clean up empty directories
      await this.removeEmptyDirs(this.config.segmentCacheRoot);
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }

  private async walkDir(
    dir: string,
  ): Promise<Array<{ path: string; atimeMs: number; mtimeMs: number; size: number }>> {
    const results: Array<{ path: string; atimeMs: number; mtimeMs: number; size: number }> = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await this.walkDir(fullPath);
          results.push(...sub);
        } else {
          const stat = await fs.stat(fullPath);
          results.push({
            path: fullPath,
            atimeMs: stat.atimeMs,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          });
        }
      }
    } catch {
      // Directory might not exist yet
    }
    return results;
  }

  private async removeEmptyDirs(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const fullPath = path.join(dir, entry.name);
          await this.removeEmptyDirs(fullPath);
          const subEntries = await fs.readdir(fullPath);
          if (subEntries.length === 0) {
            await fs.rmdir(fullPath);
          }
        }
      }
    } catch {
      // Ignore
    }
  }
}
