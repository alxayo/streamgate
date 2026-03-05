/**
 * Build the stream path prefix for a given event ID.
 * Convention: /streams/:eventId/ (PDR §4.3, §6.3)
 */
export function buildStreamPathPrefix(eventId: string): string {
  return `/streams/${eventId}/`;
}

/**
 * Validate that a request path starts with the allowed stream path prefix.
 * Used by HLS server for path-scoping JWT validation (PDR §5.4 rule 4).
 */
export function isPathAllowed(requestPath: string, allowedPrefix: string): boolean {
  return requestPath.startsWith(allowedPrefix);
}

/**
 * Validate token code format: must be alphanumeric (PDR §12).
 */
export function isValidTokenCode(code: string): boolean {
  return typeof code === 'string' && code.length > 0 && /^[A-Za-z0-9]+$/.test(code);
}
