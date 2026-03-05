import { ACCESS_WINDOW_MIN_HOURS, ACCESS_WINDOW_MAX_HOURS } from './constants.js';

/**
 * Sanitize and validate a token code input.
 * Trims whitespace, rejects non-alphanumeric characters.
 * Returns sanitized code or null if invalid.
 */
export function sanitizeTokenCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Validate access window hours (PDR §8.3: 1-168).
 */
export function isValidAccessWindow(hours: number): boolean {
  return Number.isInteger(hours) && hours >= ACCESS_WINDOW_MIN_HOURS && hours <= ACCESS_WINDOW_MAX_HOURS;
}

/**
 * Validate that startsAt is before endsAt (PDR §8.3).
 */
export function isValidEventSchedule(startsAt: Date, endsAt: Date): boolean {
  return startsAt < endsAt;
}
