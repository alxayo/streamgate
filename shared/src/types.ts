import type { PlayerConfig } from './stream-config';

/**
 * Admin user roles — ordered from most to least privileged.
 *
 * Role Hierarchy:
 *   SUPER_ADMIN    — Full access + can manage other admin users
 *   ADMIN          — Full access to events/tokens/settings (no user management)
 *   OPERATOR       — Can view events/tokens and manage live viewers
 *   VIEWER_MANAGER — Can create/revoke tokens and view events
 *   READ_ONLY      — View-only access to events, tokens, and dashboard
 *
 * See platform/src/lib/permissions.ts for the complete permission matrix.
 */
export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER_MANAGER' | 'READ_ONLY';

/** JWT playback token claims (PDR §4.3) */
export interface PlaybackTokenClaims {
  sub: string; // Access token code
  eid: string; // Event ID
  sid: string; // Active session ID (for single-device enforcement)
  sp: string; // Allowed stream path prefix (e.g., "/streams/evt-uuid/")
  iat: number; // Issued at (Unix timestamp)
  exp: number; // Expires at (Unix timestamp)
  probe?: boolean; // If true, this is a probe JWT (HEAD requests only)
}

/** Revocation sync response (PDR §10.3) */
export interface RevocationSyncResponse {
  revocations: Array<{
    code: string;
    revokedAt: string; // ISO 8601
  }>;
  eventDeactivations: Array<{
    eventId: string;
    deactivatedAt: string; // ISO 8601
    tokenCodes: string[];
  }>;
  serverTime: string; // ISO 8601
}

/** Event status values (PDR §10.1) */
export type EventStatus = 'not-started' | 'live' | 'ended' | 'recording';

/** Token status values (PDR §8.4) */
export type TokenStatus = 'unused' | 'redeemed' | 'expired' | 'revoked';

/** Public event metadata returned to viewer (PDR §10.1) */
export interface PublicEventInfo {
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  posterUrl: string | null;
  isLive: boolean;
}

/** Token validation success response (PDR §10.1) */
export interface TokenValidationResponse {
  event: PublicEventInfo;
  playbackToken: string;
  playbackBaseUrl: string;
  streamPath: string;
  expiresAt: string;
  tokenExpiresIn: number;
  playerConfig?: PlayerConfig;
}

/** JWT refresh response (PDR §10.1) */
export interface TokenRefreshResponse {
  playbackToken: string;
  tokenExpiresIn: number;
}

/** Event status response (PDR §10.1) */
export interface EventStatusResponse {
  eventId: string;
  status: EventStatus;
  startsAt: string;
  endsAt: string;
}

/** Heartbeat response (PDR §10.1) */
export interface HeartbeatResponse {
  ok: boolean;
}

/** Release response (PDR §10.1) */
export interface ReleaseResponse {
  released: boolean;
}

/** Token in-use error response (PDR §10.1, 409) */
export interface TokenInUseResponse {
  error: string;
  inUse: boolean;
}

/** Standard API error response */
export interface ApiErrorResponse {
  error: string;
}
