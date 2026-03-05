import path from 'node:path';

/**
 * Sanitize and resolve a requested file path to prevent path traversal attacks.
 * Returns the resolved absolute path, or null if the path is unsafe.
 */
export function resolveSecurePath(root: string, requestedPath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, requestedPath);
  // Ensure resolved path stays within root
  if (!resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    return null;
  }
  return resolved;
}
