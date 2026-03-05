import crypto from 'node:crypto';

/** Hash a token code for safe logging (PDR §12). Never log raw codes. */
export function hashForLog(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}
