---
sidebar_position: 4
title: Shared Library
---

# Shared Library

The `@streaming/shared` package provides TypeScript types, constants, and utility functions used by both the Platform App and HLS Media Server. It lives in the `shared/` directory and is consumed via npm workspaces — no build step required.

## Package Setup

```json title="shared/package.json"
{
  "name": "@streaming/shared",
  "version": "1.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

The package is wired via npm workspaces in the root `package.json`. Both `platform/` and `hls-server/` import from `@streaming/shared` directly:

```typescript
import { PlaybackTokenClaims, JWT_EXPIRY_SECONDS, buildStreamPathPrefix } from '@streaming/shared';
```

:::tip No Build Step
Because `main` and `types` both point to `./src/index.ts` (raw TypeScript), there is no build step. Changes to the shared library are picked up immediately by both services during development. The consuming services' bundlers (Next.js and tsx/ts-node) handle transpilation.
:::

## Exports

All public APIs are re-exported from `shared/src/index.ts`:

```typescript title="shared/src/index.ts"
export * from './types';
export * from './constants';
export * from './jwt';
export * from './validation';
```

## TypeScript Interfaces

### PlaybackTokenClaims

JWT payload structure used for playback authorization (PDR §4.3):

```typescript
export interface PlaybackTokenClaims {
  sub: string;     // Access token code (e.g., "Ab3kF9mNx2Qp")
  eid: string;     // Event ID (UUID)
  sid: string;     // Active session ID (for single-device enforcement)
  sp: string;      // Allowed stream path prefix (e.g., "/streams/evt-uuid/")
  iat: number;     // Issued at (Unix timestamp)
  exp: number;     // Expires at (Unix timestamp)
  probe?: boolean; // If true, this is a probe JWT (HEAD requests only)
}
```

### RevocationSyncResponse

Response format for the internal revocation polling endpoint (PDR §10.3):

```typescript
export interface RevocationSyncResponse {
  revocations: Array<{
    code: string;         // Revoked access token code
    revokedAt: string;    // ISO 8601 timestamp
  }>;
  eventDeactivations: Array<{
    eventId: string;       // Deactivated event ID
    deactivatedAt: string; // ISO 8601 timestamp
    tokenCodes: string[];  // All token codes for this event
  }>;
  serverTime: string;     // ISO 8601 — used as `since` for next poll
}
```

### EventStatus

Possible states for a streaming event (PDR §10.1):

```typescript
export type EventStatus = 'not-started' | 'live' | 'ended' | 'recording';
```

| Status | Meaning |
|--------|---------|
| `not-started` | Current time is before `startsAt` |
| `live` | Stream is actively broadcasting |
| `ended` | Event has concluded, no stream detected |
| `recording` | Event ended but content is still available for playback |

### TokenStatus

Token lifecycle states (PDR §8.4):

```typescript
export type TokenStatus = 'unused' | 'redeemed' | 'expired' | 'revoked';
```

### PublicEventInfo

Event metadata returned to viewers (no sensitive fields):

```typescript
export interface PublicEventInfo {
  title: string;
  description: string | null;
  startsAt: string;        // ISO 8601
  endsAt: string;          // ISO 8601
  posterUrl: string | null;
  isLive: boolean;
}
```

### API Response Types

```typescript
/** Token validation success response */
export interface TokenValidationResponse {
  event: PublicEventInfo;
  playbackToken: string;     // JWT string
  playbackBaseUrl: string;   // HLS server base URL
  streamPath: string;        // e.g., "/streams/evt-uuid/"
  expiresAt: string;         // ISO 8601 token expiry
  tokenExpiresIn: number;    // Seconds until JWT expires
}

/** JWT refresh response */
export interface TokenRefreshResponse {
  playbackToken: string;     // New JWT string
  tokenExpiresIn: number;    // Seconds until new JWT expires
}

/** Event status response */
export interface EventStatusResponse {
  eventId: string;
  status: EventStatus;
  startsAt: string;          // ISO 8601
  endsAt: string;            // ISO 8601
}

/** Heartbeat response */
export interface HeartbeatResponse {
  ok: boolean;
}

/** Session release response */
export interface ReleaseResponse {
  released: boolean;
}

/** Token in-use error (409 Conflict) */
export interface TokenInUseResponse {
  error: string;
  inUse: boolean;
}

/** Standard API error response */
export interface ApiErrorResponse {
  error: string;
}
```

## Constants

All constants reference their Product Design Review (PDR) section:

### JWT & Token

| Constant | Value | PDR | Description |
|----------|-------|-----|-------------|
| `JWT_EXPIRY_SECONDS` | `3600` | §4.3 | JWT token lifetime (1 hour) |
| `JWT_REFRESH_INTERVAL_MS` | `3000000` | §4.3 | Player refreshes JWT every 50 minutes |
| `PROBE_JWT_EXPIRY_SECONDS` | `10` | §10.1 | Probe JWT lifetime for stream status checks |
| `JWT_ALGORITHM` | `'HS256'` | — | HMAC-SHA256 signing algorithm |
| `TOKEN_CODE_LENGTH` | `12` | §5.2 | Access code length (12 chars = ~71 bits) |
| `TOKEN_CODE_CHARSET` | `'A-Za-z0-9'` | — | Base62 character set |
| `TOKEN_CODE_REGEX` | `/^[A-Za-z0-9]+$/` | §12 | Validation pattern for codes |

### Rate Limits

| Constant | Value | PDR | Description |
|----------|-------|-----|-------------|
| `RATE_LIMIT_TOKEN_VALIDATION` | `{ maxRequests: 5, windowMs: 60000 }` | §12 | 5 requests/minute per IP |
| `RATE_LIMIT_JWT_REFRESH` | `{ maxRequests: 12, windowMs: 3600000 }` | §12 | 12 requests/hour per token code |
| `RATE_LIMIT_ADMIN_LOGIN` | `{ maxRequests: 10, windowMs: 60000 }` | §12 | 10 attempts/minute per IP |

### Session & Heartbeat

| Constant | Value | PDR | Description |
|----------|-------|-----|-------------|
| `HEARTBEAT_INTERVAL_MS` | `30000` | §5.3 | Player heartbeat interval (30s) |
| `DEFAULT_SESSION_TIMEOUT_SECONDS` | `60` | §5.3 | Inactive session timeout |
| `EVENT_STATUS_POLL_INTERVAL_MS` | `30000` | §7.3 | Pre-event status polling interval |

### Event & Access Window

| Constant | Value | PDR | Description |
|----------|-------|-----|-------------|
| `DEFAULT_ACCESS_WINDOW_HOURS` | `48` | §5.1 | Default hours after event end for access |
| `ACCESS_WINDOW_MIN_HOURS` | `1` | §8.3 | Minimum access window |
| `ACCESS_WINDOW_MAX_HOURS` | `168` | §8.3 | Maximum access window (1 week) |
| `MAX_BATCH_TOKEN_COUNT` | `500` | §8.4 | Maximum tokens per batch generation |

### UI & UX

| Constant | Value | PDR | Description |
|----------|-------|-----|-------------|
| `EXPIRY_WARNING_MINUTES` | `15` | §7.2 | Minutes before expiry to show warning toast |
| `EXPIRY_GRACE_PERIOD_SECONDS` | `60` | §11 | Grace period after token expiry |

### Infrastructure

| Constant | Value | PDR | Description |
|----------|-------|-----|-------------|
| `DEFAULT_REVOCATION_POLL_INTERVAL_MS` | `30000` | §4.4 | HLS server revocation polling interval |
| `CORS_MAX_AGE_SECONDS` | `86400` | §6.4 | CORS preflight cache (24 hours) |
| `ADMIN_SESSION_EXPIRY_SECONDS` | `28800` | §8.1 | Admin cookie expiry (8 hours) |
| `STREAM_PATH_PREFIX` | `'/streams/'` | §4.3, §6.3 | Base path for all stream URLs |

## JWT Utilities

Three utility functions for JWT-related operations:

### `buildStreamPathPrefix(eventId: string): string`

Constructs the stream path prefix used in JWT `sp` claims:

```typescript
buildStreamPathPrefix('abc-123');
// → "/streams/abc-123/"
```

### `isPathAllowed(requestPath: string, allowedPrefix: string): boolean`

Validates that a request URL starts with the JWT's allowed path prefix:

```typescript
isPathAllowed('/streams/abc-123/stream.m3u8', '/streams/abc-123/');
// → true

isPathAllowed('/streams/xyz-789/stream.m3u8', '/streams/abc-123/');
// → false
```

### `isValidTokenCode(code: string): boolean`

Checks if a string is a valid token code (non-empty, alphanumeric only):

```typescript
isValidTokenCode('Ab3kF9mNx2Qp');  // → true
isValidTokenCode('');               // → false
isValidTokenCode('abc-123');        // → false (contains dash)
```

## Validation Helpers

### `sanitizeTokenCode(input: unknown): string | null`

Sanitizes and validates token code input from untrusted sources. Returns the trimmed code or `null` if invalid:

```typescript
sanitizeTokenCode('  Ab3kF9mNx2Qp  ');  // → "Ab3kF9mNx2Qp"
sanitizeTokenCode('abc-123!');            // → null (non-alphanumeric)
sanitizeTokenCode(42);                    // → null (not a string)
sanitizeTokenCode('');                    // → null (empty)
```

### `isValidAccessWindow(hours: number): boolean`

Validates that an access window value is within the allowed range (1–168 hours):

```typescript
isValidAccessWindow(48);   // → true
isValidAccessWindow(0);    // → false
isValidAccessWindow(200);  // → false
isValidAccessWindow(1.5);  // → false (must be integer)
```

### `isValidEventSchedule(startsAt: Date, endsAt: Date): boolean`

Validates that an event's start time is before its end time:

```typescript
isValidEventSchedule(
  new Date('2025-01-01T10:00:00Z'),
  new Date('2025-01-01T12:00:00Z')
);  // → true
```

## How Changes Propagate

Since the shared library has no build step, changes propagate immediately:

1. Edit a file in `shared/src/`
2. Both services pick up the change on next import (dev servers hot-reload)
3. TypeScript errors surface immediately in both consuming services

:::warning
When adding new exports, ensure they are re-exported from `shared/src/index.ts`. Otherwise the consuming services won't see them via `@streaming/shared`.
:::

To type-check the shared library in isolation:

```bash
cd shared
npm run typecheck  # tsc --noEmit
```
