---
sidebar_position: 5
title: API Reference
---

# API Reference

Complete reference for all StreamGate API endpoints. Endpoints are grouped by access level: **Public**, **Admin**, **Internal**, and **HLS Streaming**.

---

## Public API

These endpoints require no authentication and are used by the viewer's browser.

### POST /api/tokens/validate

Validates an access code and returns a JWT playback token.

**Rate limit:** 5 requests/minute per IP

**Request:**

```bash
curl -X POST http://localhost:3000/api/tokens/validate \
  -H "Content-Type: application/json" \
  -d '{"code": "Ab3kF9mNx2Qp"}'
```

**Success Response (200):**

```json
{
  "event": {
    "title": "Annual Conference 2025",
    "description": "Live keynote stream",
    "startsAt": "2025-03-15T09:00:00.000Z",
    "endsAt": "2025-03-15T17:00:00.000Z",
    "posterUrl": "https://example.com/poster.jpg",
    "isLive": true
  },
  "playbackToken": "eyJhbGciOiJIUzI1NiJ9...",
  "playbackBaseUrl": "http://localhost:4000",
  "streamPath": "/streams/abc-123-uuid/",
  "expiresAt": "2025-03-17T17:00:00.000Z",
  "tokenExpiresIn": 3600,
  "playerConfig": {
    "liveSyncDurationCount": 2,
    "liveMaxLatencyDurationCount": 4,
    "backBufferLength": 0,
    "lowLatencyMode": true
  }
}
```

:::note
`playbackBaseUrl` is dynamically derived from the request's hostname. If the request comes from `192.168.0.11:3000`, the response returns `http://192.168.0.11:4000` instead of `http://localhost:4000`.

`playerConfig` contains the merged (system defaults + per-event overrides) player configuration. The video player uses these values to configure hls.js. If absent, the player falls back to hardcoded defaults.
:::

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `400` | Missing or non-alphanumeric code | `{ "error": "Access code is required" }` |
| `401` | Code not found in database | `{ "error": "Invalid access code" }` |
| `403` | Token is revoked | `{ "error": "Access code has been revoked" }` |
| `403` | Event is deactivated | `{ "error": "This event is not currently available" }` |
| `409` | Token in use on another device | `{ "error": "This access code is currently in use on another device", "inUse": true }` |
| `410` | Token has expired | `{ "error": "Access code has expired" }` |
| `429` | Rate limited | `{ "error": "Too many requests. Please try again later." }` |

---

### POST /api/playback/refresh

Refreshes an expiring JWT. The current JWT is sent as a Bearer token.

**Rate limit:** 12 requests/hour per token code

**Request:**

```bash
curl -X POST http://localhost:3000/api/playback/refresh \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9..."
```

**Success Response (200):**

```json
{
  "playbackToken": "eyJhbGciOiJIUzI1NiJ9...(new token)",
  "tokenExpiresIn": 3600
}
```

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `401` | Missing or invalid JWT | `{ "error": "Valid playback token required" }` |
| `403` | Token has been revoked since last refresh | `{ "error": "Access has been revoked" }` |
| `410` | Token or event has expired | `{ "error": "Access has expired" }` |
| `429` | Rate limited | `{ "error": "Too many refresh requests" }` |

---

### POST /api/playback/heartbeat

Keeps the active session alive. Called every 30 seconds by the player.

**Request:**

```bash
curl -X POST http://localhost:3000/api/playback/heartbeat \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9..."
```

**Success Response (200):**

```json
{
  "ok": true
}
```

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `401` | Missing or invalid JWT | `{ "error": "Valid playback token required" }` |
| `404` | Session no longer exists | `{ "error": "Session not found" }` |

---

### POST /api/playback/release

Releases the active session. Called on player close via `navigator.sendBeacon()`.

**Request:**

```bash
curl -X POST http://localhost:3000/api/playback/release \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9..."
```

**Success Response (200):**

```json
{
  "released": true
}
```

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `401` | Missing or invalid JWT | `{ "error": "Valid playback token required" }` |

:::info
If the session was already released or timed out, the endpoint still returns `{ "released": true }` to avoid unnecessary errors in the client.
:::

---

### GET /api/events/:id/status

Returns the current status of an event. Used by the pre-event waiting screen.

**Request:**

```bash
curl http://localhost:3000/api/events/abc-123-uuid/status
```

**Success Response (200):**

```json
{
  "eventId": "abc-123-uuid",
  "status": "live",
  "startsAt": "2025-03-15T09:00:00.000Z",
  "endsAt": "2025-03-15T17:00:00.000Z"
}
```

The `status` field is one of: `not-started`, `live`, `ended`, `recording`.

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `404` | Event not found | `{ "error": "Event not found" }` |

---

## Admin API

All admin endpoints require an authenticated session via the `iron-session` cookie. Send credentials first via `/api/admin/login`.

### Authentication

#### POST /api/admin/login

**Rate limit:** 10 requests/minute per IP

```bash
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-admin-password"}' \
  -c cookies.txt
```

**Success (200):** `{ "success": true }`

**Error:**

| Status | Condition | Body |
|--------|-----------|------|
| `401` | Wrong password | `{ "error": "Invalid password" }` |
| `429` | Rate limited | `{ "error": "Too many login attempts" }` |

#### POST /api/admin/logout

```bash
curl -X POST http://localhost:3000/api/admin/logout -b cookies.txt
```

**Response (200):** `{ "success": true }`

#### GET /api/admin/session

Check if the current session is authenticated:

```bash
curl http://localhost:3000/api/admin/session -b cookies.txt
```

**Response (200):** `{ "authenticated": true }`

---

### Events

#### GET /api/admin/events

List all events:

```bash
curl http://localhost:3000/api/admin/events -b cookies.txt
```

**Response (200):**

```json
{
  "events": [
    {
      "id": "abc-123",
      "title": "Annual Conference 2025",
      "description": "Live keynote stream",
      "streamUrl": null,
      "posterUrl": null,
      "startsAt": "2025-03-15T09:00:00.000Z",
      "endsAt": "2025-03-15T17:00:00.000Z",
      "accessWindowHours": 48,
      "isActive": true,
      "isArchived": false,
      "createdAt": "2025-03-01T12:00:00.000Z",
      "updatedAt": "2025-03-01T12:00:00.000Z",
      "_count": { "tokens": 100 }
    }
  ]
}
```

#### POST /api/admin/events

Create a new event:

```bash
curl -X POST http://localhost:3000/api/admin/events \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "title": "Annual Conference 2025",
    "description": "Live keynote stream",
    "startsAt": "2025-03-15T09:00:00.000Z",
    "endsAt": "2025-03-15T17:00:00.000Z",
    "accessWindowHours": 48,
    "streamUrl": "https://origin.example.com/live/stream.m3u8",
    "posterUrl": "https://example.com/poster.jpg"
  }'
```

**Response (201):** Full event object.

#### GET /api/admin/events/:id

Get single event with details:

```bash
curl http://localhost:3000/api/admin/events/abc-123 -b cookies.txt
```

#### PUT /api/admin/events/:id

Update an event:

```bash
curl -X PUT http://localhost:3000/api/admin/events/abc-123 \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{ "title": "Updated Title", "accessWindowHours": 72 }'
```

#### DELETE /api/admin/events/:id

Delete an event and all associated tokens (cascading delete):

```bash
curl -X DELETE http://localhost:3000/api/admin/events/abc-123 -b cookies.txt
```

**Response (200):** `{ "deleted": true }`

#### PATCH /api/admin/events/:id/activate

```bash
curl -X PATCH http://localhost:3000/api/admin/events/abc-123/activate -b cookies.txt
```

#### PATCH /api/admin/events/:id/deactivate

Deactivating an event effectively revokes all its tokens (picked up by HLS revocation sync).

```bash
curl -X PATCH http://localhost:3000/api/admin/events/abc-123/deactivate -b cookies.txt
```

#### PATCH /api/admin/events/:id/archive

```bash
curl -X PATCH http://localhost:3000/api/admin/events/abc-123/archive -b cookies.txt
```

#### PATCH /api/admin/events/:id/unarchive

```bash
curl -X PATCH http://localhost:3000/api/admin/events/abc-123/unarchive -b cookies.txt
```

---

### Tokens

#### GET /api/admin/events/:id/tokens

List tokens for a specific event:

```bash
curl http://localhost:3000/api/admin/events/abc-123/tokens -b cookies.txt
```

**Response (200):**

```json
{
  "tokens": [
    {
      "id": "tok-uuid",
      "code": "Ab3kF9mNx2Qp",
      "eventId": "abc-123",
      "label": "VIP Guest 1",
      "isRevoked": false,
      "revokedAt": null,
      "redeemedAt": "2025-03-15T10:30:00.000Z",
      "redeemedIp": "192.168.1.50",
      "expiresAt": "2025-03-17T17:00:00.000Z",
      "createdAt": "2025-03-01T12:00:00.000Z"
    }
  ]
}
```

#### POST /api/admin/events/:id/tokens

Generate tokens for an event (batch: 1–500):

```bash
curl -X POST http://localhost:3000/api/admin/events/abc-123/tokens \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{ "count": 50, "label": "Batch A" }'
```

**Response (201):**

```json
{
  "tokens": [
    { "id": "tok-1", "code": "Ab3kF9mNx2Qp", "label": "Batch A", ... },
    { "id": "tok-2", "code": "Xp2mNqR7sT4w", "label": "Batch A", ... }
  ],
  "count": 50
}
```

#### GET /api/admin/events/:id/tokens/export

Export tokens as CSV:

```bash
curl http://localhost:3000/api/admin/events/abc-123/tokens/export \
  -b cookies.txt -o tokens.csv
```

Returns CSV with headers: `code,label,status,createdAt,expiresAt`

#### GET /api/admin/tokens

List all tokens across all events (with optional filters):

```bash
curl "http://localhost:3000/api/admin/tokens?status=revoked&eventId=abc-123" \
  -b cookies.txt
```

#### PATCH /api/admin/tokens/:id/revoke

Revoke a single token:

```bash
curl -X PATCH http://localhost:3000/api/admin/tokens/tok-uuid/revoke -b cookies.txt
```

**Response (200):** Updated token object with `isRevoked: true` and `revokedAt` timestamp.

#### PATCH /api/admin/tokens/:id/unrevoke

Unrevoke a previously revoked token:

```bash
curl -X PATCH http://localhost:3000/api/admin/tokens/tok-uuid/unrevoke -b cookies.txt
```

#### POST /api/admin/tokens/bulk-revoke

Revoke multiple tokens at once:

```bash
curl -X POST http://localhost:3000/api/admin/tokens/bulk-revoke \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{ "tokenIds": ["tok-1", "tok-2", "tok-3"] }'
```

**Response (200):** `{ "revoked": 3 }`

#### GET /api/admin/dashboard

Get dashboard statistics:

```bash
curl http://localhost:3000/api/admin/dashboard -b cookies.txt
```

**Response (200):**

```json
{
  "totalEvents": 12,
  "activeEvents": 5,
  "totalTokens": 500,
  "redeemedTokens": 150,
  "activeViewers": 42
}
```

---

## Internal API

Used by the HLS Media Server and HLS Transcoder for revocation synchronization and stream configuration. Authenticated via `X-Internal-Api-Key` header.

### GET /api/revocations

Fetches token revocations and event deactivations since a given timestamp.

**Request:**

```bash
curl "http://localhost:3000/api/revocations?since=2025-03-15T10:00:00.000Z" \
  -H "X-Internal-Api-Key: your-internal-api-key"
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `since` | ISO 8601 string | Yes | Only return revocations after this timestamp |

**Success Response (200):**

```json
{
  "revocations": [
    {
      "code": "Ab3kF9mNx2Qp",
      "revokedAt": "2025-03-15T11:30:00.000Z"
    },
    {
      "code": "Xp2mNqR7sT4w",
      "revokedAt": "2025-03-15T12:00:00.000Z"
    }
  ],
  "eventDeactivations": [
    {
      "eventId": "evt-456",
      "deactivatedAt": "2025-03-15T11:45:00.000Z",
      "tokenCodes": ["Cd4eF5gH6iJk", "Lm7nO8pQ9rSt"]
    }
  ],
  "serverTime": "2025-03-15T12:05:00.000Z"
}
```

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `401` | Missing or invalid `X-Internal-Api-Key` | `{ "error": "Unauthorized" }` |
| `400` | Missing `since` parameter | `{ "error": "since parameter required" }` |

:::info
The `serverTime` field in the response should be used as the `since` value for the next poll. This ensures no revocations are missed between polls, even if clocks are slightly out of sync.
:::

---

### GET /api/internal/stream-config/defaults

Returns system-wide transcoder and player defaults. Used by the HLS transcoder to cache defaults at startup and refresh periodically.

**Request:**

```bash
curl http://localhost:3000/api/internal/stream-config/defaults \
  -H "X-Internal-Api-Key: your-internal-api-key"
```

**Success Response (200):**

```json
{
  "transcoder": {
    "codecs": ["h264"],
    "profile": "full-abr-1080p-720p-480p",
    "hlsTime": 2,
    "hlsListSize": 6,
    "forceKeyFrameInterval": 2,
    "h264": { "tune": "zerolatency", "preset": "ultrafast" }
  },
  "player": {
    "liveSyncDurationCount": 2,
    "liveMaxLatencyDurationCount": 4,
    "backBufferLength": 0,
    "lowLatencyMode": true
  }
}
```

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `401` | Missing or invalid `X-Internal-Api-Key` | `{ "error": "Unauthorized" }` |

:::info Bootstrap Guard
If the `SystemSettings` row doesn't exist in the database, this endpoint automatically creates it with hardcoded defaults and returns those. It never returns a 500 for a missing row.
:::

---

### GET /api/internal/events/:id/stream-config

Returns the merged (effective) stream configuration for a specific event. The transcoder calls this endpoint on each `publish_start` to get the FFmpeg arguments for the event.

**Request:**

```bash
curl http://localhost:3000/api/internal/events/abc-123/stream-config \
  -H "X-Internal-Api-Key: your-internal-api-key"
```

**Success Response (200):**

```json
{
  "eventId": "abc-123",
  "eventActive": true,
  "configSource": "event",
  "transcoder": {
    "codecs": ["h264"],
    "profile": "full-abr-1080p-720p-480p",
    "hlsTime": 2,
    "hlsListSize": 6,
    "forceKeyFrameInterval": 2,
    "h264": { "tune": "zerolatency", "preset": "ultrafast" }
  },
  "player": {
    "liveSyncDurationCount": 2,
    "liveMaxLatencyDurationCount": 4,
    "backBufferLength": 0,
    "lowLatencyMode": true
  }
}
```

The `configSource` field is `"event"` when the event has per-event overrides, or `"system-default"` when using only system defaults. This is for observability only.

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `401` | Missing or invalid `X-Internal-Api-Key` | `{ "error": "Unauthorized" }` |
| `404` | Event not found or deactivated | `{ "error": "Event not found" }` |

---

### GET /api/admin/events/:id/stream-config

Returns the effective stream configuration and RTMP ingest endpoints for an event. Used by the admin event detail page.

**Request:**

```bash
curl http://localhost:3000/api/admin/events/abc-123/stream-config \
  -b cookies.txt
```

**Success Response (200):**

```json
{
  "streamConfig": {
    "transcoder": { ... },
    "player": { ... }
  },
  "configSource": "default",
  "ingestEndpoints": {
    "rtmpUrl": "rtmp://rtmp.example.com:1935/live/abc-123?token=secret",
    "obsServer": "rtmp://rtmp.example.com:1935/live",
    "obsStreamKey": "abc-123?token=secret",
    "srtUrl": null
  }
}
```

---

### GET /api/admin/settings

Returns the current system-wide stream defaults.

```bash
curl http://localhost:3000/api/admin/settings -b cookies.txt
```

### PUT /api/admin/settings

Updates system-wide transcoder and player defaults.

```bash
curl -X PUT http://localhost:3000/api/admin/settings \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "transcoderDefaults": { "hlsTime": 2, "profile": "full-abr-1080p-720p-480p", ... },
    "playerDefaults": { "liveSyncDurationCount": 2, ... }
  }'
```

---

## HLS Streaming API

These endpoints are served by the HLS Media Server (default port 4000).

### GET /streams/:eventId/*.m3u8

Serves HLS manifest files. Requires JWT authorization.

**Request:**

```bash
curl http://localhost:4000/streams/abc-123/stream.m3u8 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9..."
```

**Response:** HLS manifest content with `Content-Type: application/vnd.apple.mpegurl`.

**Error Responses:**

| Status | Condition | Body |
|--------|-----------|------|
| `401` | No JWT provided | `{ "error": "Authorization required" }` |
| `403` | JWT invalid/expired/revoked/wrong path | `{ "error": "Access denied" }` |
| `404` | Manifest file not found | `{ "error": "Not found" }` |

### GET /streams/:eventId/*.ts

Serves HLS transport stream segments. Same auth as manifests.

```bash
curl http://localhost:4000/streams/abc-123/segment-001.ts \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9..." \
  -o segment.ts
```

### GET /health

Health check endpoint (no auth required):

```bash
curl http://localhost:4000/health
```

**Response (200):**

```json
{
  "status": "ok",
  "mode": "hybrid",
  "revocationCacheSize": 42,
  "lastSyncAgoSeconds": 15
}
```

### DELETE /admin/cache/:eventId

Clears cached segments for an event (no JWT auth — restrict via network policy):

```bash
curl -X DELETE http://localhost:4000/admin/cache/abc-123
```

**Response (200):** `{ "cleared": true }`

:::warning
This endpoint is not protected by JWT authentication. In production, restrict access via firewall rules or reverse proxy configuration.
:::
