---
sidebar_position: 3
title: HLS Media Server
---

# HLS Media Server

The HLS Media Server is a lightweight **Express.js** application that serves HLS video streams (`.m3u8` manifests and `.ts` segments) with JWT-based authorization on every request. It has **no database dependency** — all auth is done via HMAC-SHA256 JWT verification and an in-memory revocation cache.

## Directory Structure

```
hls-server/
├── src/
│   ├── index.ts               # Entry point — starts Express server
│   ├── config.ts              # Environment variable loading + validation
│   ├── types.ts               # Local type definitions (AuthenticatedRequest)
│   ├── middleware/
│   │   ├── cors-config.ts     # CORS setup (restrict to Platform App origin)
│   │   ├── error-handler.ts   # Global error handler (vague responses)
│   │   ├── jwt-auth.ts        # JWT extraction + verification + revocation check
│   │   └── request-logger.ts  # Request logging (strips __token from URLs)
│   ├── routes/
│   │   ├── admin-cache.ts     # DELETE /admin/cache/:eventId
│   │   ├── health.ts          # GET /health
│   │   └── streams.ts         # GET /streams/:eventId/* (main streaming route)
│   ├── services/
│   │   ├── cache-cleanup.ts   # Background LRU eviction + age-based cleanup
│   │   ├── content-resolver.ts # Resolve content from local/cache/upstream
│   │   ├── inflight-dedup.ts  # Deduplicate concurrent upstream fetches
│   │   ├── jwt-verifier.ts    # JWT signature + path verification
│   │   ├── revocation-cache.ts # In-memory Map<code, timestamp>
│   │   ├── revocation-sync.ts # Background polling of Platform App
│   │   ├── segment-cache.ts   # Persistent disk cache for proxied segments
│   │   └── upstream-proxy.ts  # Fetch segments from upstream origin
│   └── utils/
│       └── path-safety.ts     # Path traversal prevention
├── package.json
└── tsconfig.json
```

## Request Flow

Every streaming request passes through the following pipeline:

```
Client Request
GET /streams/:eventId/stream.m3u8
Authorization: Bearer <JWT>
        │
        ▼
┌───────────────┐
│  CORS Check   │ ← corsAllowedOrigin env var
│  (preflight)  │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│  Request      │ ← Logs method, URL, IP (strips __token)
│  Logger       │
└───────┬───────┘
        │
        ▼
┌───────────────────────────────────────────────────┐
│  JWT Auth Middleware                               │
│                                                    │
│  1. Extract token from:                            │
│     - Authorization: Bearer <JWT>   (preferred)    │
│     - ?__token=<JWT>                (Safari)       │
│  2. Verify signature (HMAC-SHA256)                 │
│  3. Check expiry (exp claim)                       │
│  4. Validate path prefix (sp claim vs request URL) │
│  5. Check probe-only restriction (HEAD only)       │
│  6. Check revocation cache (sub claim)             │
│  7. Attach claims to request object                │
└───────┬───────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────┐
│  Content Resolution               │
│                                    │
│  local mode:  disk → 404          │
│  proxy mode:  cache → upstream    │
│  hybrid mode: disk → cache →      │
│               upstream → 404      │
└───────┬───────────────────────────┘
        │
        ▼
┌───────────────┐
│  Serve File   │ ← Correct Content-Type header
│  200 OK       │   (.m3u8 → application/vnd.apple.mpegurl)
└───────────────┘   (.ts   → video/mp2t)
```

## JWT Verification Pipeline

The `jwt-auth.ts` middleware performs a 6-step verification on every request:

### Step 1: Extract Token

```typescript
// Preferred: Authorization header
const authHeader = req.headers.authorization;
if (authHeader?.startsWith('Bearer ')) {
  token = authHeader.slice(7);
}

// Fallback: Safari query parameter
if (!token && typeof req.query.__token === 'string') {
  token = req.query.__token;
}
```

### Step 2: Verify Signature

Using `jose.jwtVerify()` with the shared `PLAYBACK_SIGNING_SECRET` and `HS256` algorithm. Verification time is approximately **0.01ms**.

### Step 3: Check Expiry

Built into `jose.jwtVerify()` — automatically rejects tokens where `exp < now`.

### Step 4: Validate Path Prefix

The JWT's `sp` (stream path) claim must be a prefix of the requested URL:

```typescript
// JWT claims: sp = "/streams/abc-123/"
// Request:    /streams/abc-123/stream.m3u8  ✓
// Request:    /streams/xyz-789/stream.m3u8  ✗ Access denied
```

This prevents a JWT issued for one event from accessing another event's streams.

### Step 5: Probe Restriction

If `claims.probe === true`, only `HEAD` requests are allowed. This supports stream status probing without granting full stream access.

### Step 6: Check Revocation Cache

```typescript
if (claims.sub && revocationCache.isRevoked(claims.sub)) {
  res.status(403).json({ error: 'Access denied' });
  return;
}
```

:::danger
All verification failures return the same generic `{ error: "Access denied" }` or `{ error: "Authorization required" }`. The HLS server **never reveals** whether a token was revoked, expired, or had an invalid signature — this is intentional to prevent information leakage.
:::

## Content Source Modes

The HLS server supports three content modes, determined by which environment variables are set:

### Local Mode

Set `STREAM_ROOT` only. Content is served directly from disk.

```bash
STREAM_ROOT=/var/streams
```

```
Filesystem layout:
/var/streams/
├── event-uuid-1/
│   ├── stream.m3u8
│   ├── segment-001.ts
│   └── segment-002.ts
└── event-uuid-2/
    └── ...
```

Requests map to `STREAM_ROOT/:eventId/:filename`.

### Proxy Mode

Set `UPSTREAM_ORIGIN` only. Content is fetched from an upstream server and cached locally.

```bash
UPSTREAM_ORIGIN=https://cdn.example.com
SEGMENT_CACHE_ROOT=/var/cache/segments  # defaults to STREAM_ROOT/cache/
```

The `upstream-proxy` service fetches content from the origin and the `segment-cache` service writes it to disk for subsequent requests.

### Hybrid Mode

Set **both** `STREAM_ROOT` and `UPSTREAM_ORIGIN`. Local files take priority; upstream is used as fallback.

```bash
STREAM_ROOT=/var/streams
UPSTREAM_ORIGIN=https://cdn.example.com
```

Resolution order:
1. Check local disk (`STREAM_ROOT/:eventId/:filename`)
2. Check segment cache (`SEGMENT_CACHE_ROOT/:eventId/:filename`)
3. Fetch from upstream origin
4. Return 404

:::tip
Hybrid mode is useful when some events use local files (e.g., pre-recorded content) and others stream from an upstream source.
:::

## Segment Caching

When operating in proxy or hybrid mode, fetched segments are persistently cached to disk.

### Cache Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SEGMENT_CACHE_ROOT` | `STREAM_ROOT/cache/` | Root directory for cached segments |
| `SEGMENT_CACHE_MAX_SIZE_GB` | `50` | Maximum cache size before LRU eviction |
| `SEGMENT_CACHE_MAX_AGE_HOURS` | `72` | Maximum age before time-based eviction |

### LRU Eviction

The `cache-cleanup` service runs periodically and:
1. Removes segments older than `SEGMENT_CACHE_MAX_AGE_HOURS`
2. If total cache size exceeds `SEGMENT_CACHE_MAX_SIZE_GB`, removes least-recently-accessed files first

### In-Flight Deduplication

The `inflight-dedup` service prevents multiple concurrent requests for the same segment from triggering multiple upstream fetches:

```
Request A: GET /streams/evt-1/seg-005.ts  → Cache miss → Start fetch
Request B: GET /streams/evt-1/seg-005.ts  → Cache miss → Wait for A's fetch
Request C: GET /streams/evt-1/seg-005.ts  → Cache miss → Wait for A's fetch
                                             A completes → Serve to A, B, C
```

### Manifest Caching Rules

:::warning
`.m3u8` manifests are **not** cached persistently during live streams. They change frequently (new segments are appended), so caching would serve stale playlists. Only `.ts` segments are cached.
:::

## Revocation Sync

The `RevocationSyncService` runs as a background loop:

```typescript
class RevocationSyncService {
  start(): void {
    this.sync();  // Immediate first sync
    this.intervalId = setInterval(
      () => this.sync(),
      config.revocationPollIntervalMs  // Default: 30,000ms
    );
  }

  private async sync(): Promise<void> {
    // GET /api/revocations?since=<lastSyncTimestamp>
    // Headers: { 'X-Internal-Api-Key': config.internalApiKey }
    //
    // Process response:
    // - data.revocations → add each code to RevocationCache
    // - data.eventDeactivations → add all associated token codes
    // - Update lastSyncTimestamp to data.serverTime
  }
}
```

### Failure Tolerance

| Scenario | Behavior |
|----------|----------|
| Platform App unreachable | Logs error, retries next interval, serves with stale cache |
| HTTP error response | Logs status code, retries next interval |
| 5+ minutes of failures | Logs `ALERT` message for monitoring |
| Platform App recovers | Next successful sync catches up via incremental `since` parameter |

### Cache Eviction

The revocation cache grows over time as tokens are revoked. The `evictOlderThan()` method removes entries for tokens whose natural expiry has passed (i.e., the JWT would be rejected by expiry check anyway, so the revocation entry is redundant).

## CORS Configuration

CORS is configured to allow requests from the Platform App origin(s):

```typescript
// cors-config.ts
const origins = config.corsAllowedOrigin.split(',').map((o) => o.trim());
cors({
  origin: origins.length === 1 ? origins[0] : origins,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Range'],
  maxAge: 86400,  // 24-hour preflight cache
})
```

`CORS_ALLOWED_ORIGIN` supports **comma-separated values** for multiple origins:

```env
# Single origin (localhost only)
CORS_ALLOWED_ORIGIN=http://localhost:3000

# Multiple origins (localhost + LAN IP)
CORS_ALLOWED_ORIGIN=http://localhost:3000,http://192.168.0.11:3000
```

:::note
Only `GET`, `HEAD`, and `OPTIONS` methods are allowed. The HLS server is read-only from the browser's perspective.
:::

## Health Endpoint

```
GET /health

Response:
{
  "status": "ok",
  "mode": "hybrid",              // Content source mode
  "revocationCacheSize": 42,     // Number of cached revocations
  "lastSyncAgoSeconds": 15       // Seconds since last successful sync
}
```

Use `lastSyncAgoSeconds` for monitoring — values consistently above 60 indicate sync problems.

## Error Responses

All error responses are intentionally vague to prevent information leakage:

| Status | Body | Meaning |
|--------|------|---------|
| `401` | `{ "error": "Authorization required" }` | No JWT provided |
| `403` | `{ "error": "Access denied" }` | JWT invalid, expired, wrong path, revoked, or probe misuse |
| `404` | `{ "error": "Not found" }` | Content file not found |

:::danger Security: Intentionally Vague
The HLS server **never** distinguishes between "invalid signature", "expired token", "wrong event", or "revoked token" in its error responses. All return the same `403 Access denied`. This is a deliberate security decision.
:::

## Safari Query Parameter Fallback

Safari's native HLS player (`<video>` tag without hls.js) cannot set custom headers on media requests. For Safari compatibility:

1. The player appends `?__token=<JWT>` to HLS URLs
2. The JWT auth middleware checks `req.query.__token` as a fallback
3. The request logger **strips** the `__token` parameter from logged URLs to prevent JWT leakage in logs

```typescript
// request-logger.ts strips __token before logging
const sanitizedUrl = url.replace(/[?&]__token=[^&]+/, '');
```

## Admin Cache Management

```
DELETE /admin/cache/:eventId

Response: { "cleared": true }
```

This endpoint clears cached segments for a specific event. Useful when:
- Upstream content has been updated and you need to force re-fetch
- An event has ended and you want to reclaim disk space immediately

:::note
This endpoint is not protected by JWT — it should be restricted via network policy or reverse proxy rules in production.
:::
