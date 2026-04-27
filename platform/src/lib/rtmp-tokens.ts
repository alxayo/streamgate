/**
 * RTMP Token & Stream Key Generation
 * 
 * Generates:
 * 1. RTMP Token: 24-char base62 HMAC-based token for publisher authentication
 * 2. Stream Key Hash: Deterministic slug-based identifier for event discovery
 */

import crypto from 'crypto';

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate a 24-character base62 RTMP token
 * Uses HMAC-based deterministic generation with event title for entropy
 */
export function generateRtmpToken(eventId: string, eventTitle: string, secret?: string): string {
  const hmacSecret = secret || (process.env.PLAYBACK_SIGNING_SECRET || 'dev-secret');
  
  // Create deterministic HMAC input from eventId + title
  const input = `${eventId}:${eventTitle}:rtmp`;
  const hmac = crypto.createHmac('sha256', hmacSecret);
  hmac.update(input);
  const digest = hmac.digest('hex');
  
  // Convert hex to base62 (take first 24 chars)
  let base62 = '';
  for (let i = 0; i < 24; i++) {
    const byte = parseInt(digest.substr(i * 2, 2), 16);
    base62 += BASE62_CHARS[byte % 62];
  }
  
  return base62;
}

/**
 * Generate a hashed stream key (slug-based)
 * Deterministic: SHA256(eventId).hex().substr(0, 12)
 * Format: "{title-slug}-{hash}"
 * 
 * Example output: "tech-talk-2024-abc123def456"
 */
export function generateStreamKeyHash(eventId: string, eventTitle: string): string {
  // Create slug from title
  const slug = eventTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substr(0, 30);
  
  // Create deterministic hash from eventId
  const hash = crypto
    .createHash('sha256')
    .update(eventId)
    .digest('hex')
    .substr(0, 12);
  
  return `${slug}-${hash}`;
}

/**
 * Validate RTMP token format (must be 24 alphanumeric chars)
 */
export function isValidRtmpToken(token: string): boolean {
  return /^[a-zA-Z0-9]{24}$/.test(token);
}

/**
 * Validate stream key hash format
 */
export function isValidStreamKeyHash(hash: string): boolean {
  // Format: slug-hash (slug contains alphanumeric and hyphens, hash is 12 hex chars)
  return /^[a-z0-9-]+-[a-f0-9]{12}$/.test(hash);
}
