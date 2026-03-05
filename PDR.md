# Product Design Requirements — Ticket-Gated Video Streaming Platform

## 1. Product Overview

A ticket-gated HTML5 video streaming platform consisting of **three independently deployable services**:

1. **Platform App** (Next.js) — Two-in-one web application containing:
   - **Viewer Portal** (public) — A page where end-users enter a unique access token (ticket) to watch a specific live stream or recording via an embedded HTML5/HLS player.
   - **Admin Console** (protected) — A management interface where operators create streaming events, generate and manage access tokens, and monitor usage.
   - **Platform API** — REST endpoints for token validation, event/token CRUD, and JWT playback token issuance.

2. **HLS Media Server** (Node.js / Express) — A dedicated streaming server that:
   - Serves HLS manifests (`.m3u8`) and media segments (`.ts`) from local storage or upstream origin.
   - **Validates a JWT playback token on every request** (manifest and segment) via a cryptographic signature check — no database query required.
   - Maintains a **local in-memory revocation cache** synced from the Platform App to handle token revocation with near-zero latency.
   - Can run on the same machine as the Platform App or on a completely separate server / CDN edge node.

3. **Shared Token Infrastructure** — The two services are loosely coupled through:
   - A **shared HMAC signing secret** used to issue and verify JWT playback tokens.
   - A lightweight **revocation sync endpoint** on the Platform App that the HLS server polls periodically.

### How It Works (End-to-End)

```
User enters ticket code → Platform App validates against DB → Platform App mints
a short-lived JWT (playback token) containing { eventId, tokenCode, streamPath, exp }
→ JWT returned to browser → hls.js attaches JWT as Authorization header on every
HLS request → HLS Media Server verifies JWT signature (CPU-only, ~0.01ms) + checks
local revocation cache → serves or rejects the segment
```

Each access token is cryptographically unique, bound to exactly one stream/event, and time-limited (configurable 24–48 hour access window). Users receive tokens out-of-band (email, print, QR, etc.) and redeem them on the Viewer Portal.

---

## 2. Experience Qualities

1. **Intuitive** — Controls should be immediately familiar and respond predictably to user interactions. Token entry should be frictionless (single field, paste-friendly, no account creation required).
2. **Polished** — Every detail from hover states to animations should feel refined and purposeful.
3. **Immersive** — The interface should fade away when not needed, keeping focus on the content.
4. **Trustworthy** — Clear feedback at every step: token accepted/rejected, stream loading, access expiring soon, access expired.

---

## 3. Complexity Level

**Medium-High Application** — Three independently deployable services (Platform App, HLS Media Server, shared token infrastructure), two distinct user interfaces (Viewer Portal and Admin Console), JWT-based playback authentication validated on every HLS segment request, in-memory revocation caching, CRUD operations for events and tokens, and stateful video playback with HLS streaming.

---

## 4. System Architecture

### 4.1 High-Level Components

```
                     ┌──────────────────────────────────────┐
                     │           Viewer Portal              │
                     │  (Public)  Token Entry → Player UI   │
                     └──────────┬───────────┬───────────────┘
                                │           │
               Token Validation │           │ HLS Requests
               (REST)           │           │ (Authorization: Bearer <JWT>)
                                │           │
  ┌─────────────────────────────▼──┐   ┌────▼─────────────────────────────┐
  │        Platform App            │   │       HLS Media Server           │
  │  (Next.js)                     │   │  (Node.js / Express)             │
  │                                │   │                                  │
  │  • Viewer API                  │   │  • JWT signature verification    │
  │    - POST /api/tokens/validate │   │    (HMAC, CPU-only, ~0.01ms)     │
  │    - POST /api/playback/refresh│   │  • Local revocation cache        │
  │  • Admin Console UI            │   │    (in-memory Map, polled)       │
  │    - Event CRUD                │   │  • Serve .m3u8 manifests         │
  │    - Token generation/mgmt     │   │  • Serve .ts segments            │
  │  • Admin API                   │   │  • Optional: proxy to upstream   │
  │  • Revocation sync endpoint    │   │    origin server                 │
  │    - GET /api/revocations      │   │                                  │
  │                                │   │                                  │
  └──────────┬─────────────────────┘   └──────────┬───────────────────────┘
             │                                    │
             │                         Polls every 30s
             │                    GET /api/revocations
             │                                    │
             ▼                                    │
        ┌─────────┐                               │
        │ Database │◄──────────────────────────────┘
        │ (SQLite/ │   (No direct DB access —
        │  Postgres)│    only via Platform API)
        └─────────┘

  ┌─────────────────────────────────────────────────────────┐
  │              Shared: HMAC Signing Secret                 │
  │  (PLAYBACK_SIGNING_SECRET environment variable on both) │
  └─────────────────────────────────────────────────────────┘
```

### 4.2 Service Communication

| From | To | Protocol | Purpose |
|------|----|----------|---------|
| Browser → Platform App | HTTPS REST | Token validation, JWT issuance, JWT refresh, admin operations |
| Browser → HLS Media Server | HTTPS + `Authorization` header | HLS manifest & segment requests with JWT playback token |
| HLS Media Server → Platform App | HTTPS REST (internal) | Poll `/api/revocations` every 30s for revoked token codes |
| Platform App → Database | Prisma ORM | CRUD for events, tokens, audit logs |

### 4.3 JWT Playback Token Design

When a user successfully validates their access code on the Platform App, the API mints a **short-lived JWT** (the "playback token") that the browser's hls.js player attaches to every HLS request.

**JWT Claims:**
```json
{
  "sub": "ABCDEF123456",       // The original access token code
  "eid": "event-uuid",         // Event ID
  "sid": "session-uuid",       // Active session ID (for single-device enforcement)
  "sp":  "/streams/event-uuid/",    // Allowed stream path prefix (convention-based, derived from event ID)
  "iat": 1741190400,           // Issued at (Unix timestamp)
  "exp": 1741194000            // Expires at (1 hour from issuance)
}
```

**Token lifecycle:**
1. **Issuance**: Platform App creates JWT signed with `PLAYBACK_SIGNING_SECRET` (HMAC-SHA256) after validating the access code against the database and confirming no active session exists. An active session record is created simultaneously, and its `sessionId` is embedded in the JWT's `sid` claim.
2. **Attachment**: hls.js is configured via `xhrSetup` to add `Authorization: Bearer <JWT>` header to every HTTP request (manifests and segments).
3. **Verification**: HLS Media Server verifies the JWT signature (pure CPU, no I/O), checks `exp`, and confirms the requested path starts with the `sp` claim.
4. **Heartbeat**: The player sends `POST /api/playback/heartbeat` every 30 seconds with the current JWT as `Authorization: Bearer` header. The server updates the session's `lastHeartbeat` timestamp. If a heartbeat fails (session expired or taken over), the player shows an appropriate message.
5. **Refresh**: The player calls `POST /api/playback/refresh` every 50 minutes (before the 60-minute JWT expiry), sending the current (nearly-expired) JWT as `Authorization: Bearer` header. The server extracts the access code from the JWT's `sub` claim and session ID from the `sid` claim, re-validates both against the database, and issues a fresh JWT with the same `sid`. If the access code has been revoked/expired or the session is no longer valid, the refresh fails → player shows "access ended". Requiring the current JWT as proof prevents the refresh endpoint from being used as an alternative validation endpoint.
6. **Release**: When the player is closed (page unload, navigation away, or explicit stop), it sends `POST /api/playback/release` with the current JWT to delete the active session, freeing the token for another device.
7. **Revocation window**: Between refresh cycles, revoked tokens are caught by the HLS server's revocation cache (synced every 30 seconds). Maximum worst-case delay before a revoked token is blocked: 30 seconds.

### 4.4 Revocation Cache (HLS Media Server)

The HLS Media Server maintains a lightweight **in-memory `Map<string, number>`** mapping revoked access token codes to their revocation timestamps:

- **Sync mechanism**: Every 30 seconds, the HLS server calls `GET /api/revocations?since=<lastSyncTimestamp>` on the Platform App.
- **Response**: A JSON array of `{ code, revokedAt }` entries that have been revoked since the given timestamp, **plus** `{ eventId, deactivatedAt }` entries for events that have been deactivated since the given timestamp.
- **Cache behavior**: Revoked codes are added to the Map (code → revokedAt timestamp). Deactivated events cause all tokens for that event to be looked up and added to the Map. Entries are evicted from the Map after their corresponding event's access window has elapsed (they will have naturally expired by then, so no longer needed).
- **On JWT validation**: After verifying the JWT signature and expiry, the HLS server checks if `jwt.sub` (the access code) is in the revocation Map. If found → reject with `403`.
- **Failure tolerance**: If the Platform App is unreachable during a poll cycle, the HLS server continues using its existing cache and retries on the next cycle. A `lastSuccessfulSync` timestamp is tracked to detect extended outages (alert after 5 minutes of failed polls).

### 4.5 Why Not Query the Database on Every Segment Request?

An HLS player requests a new segment every **2–6 seconds**. With 1,000 concurrent viewers, that's **160–500 database queries per second** just for token validation. This approach avoids that:

| Approach | Validation Latency | DB Load per 1K Viewers | Revocation Delay |
|----------|-------------------|----------------------|-----------------|
| ❌ DB query per segment | ~5–50ms | 160–500 queries/sec | Instant |
| ❌ Redis cache per segment | ~1–5ms | 0 (but Redis dependency) | Cache TTL |
| ✅ **JWT + revocation cache** | **~0.01ms** | **0** (poll every 30s) | **≤ 30s** |

The JWT approach provides sub-millisecond validation, zero database load from segment requests, and near-instant revocation — with the simplicity of a single shared secret and no additional infrastructure (no Redis, no distributed cache).

### 4.6 Tech Stack

| Layer | Technology | Service |
|-------|-----------|---------|
| Frontend Framework | Next.js 14+ (TypeScript), React 18+ | Platform App |
| Styling / UI | Tailwind CSS, shadcn/ui, Radix Themes | Platform App |
| Icons | Lucide React | Platform App |
| Animation | Framer Motion | Platform App |
| Fonts | Inter (UI), JetBrains Mono (time/token display) | Platform App |
| Video (client) | hls.js (HLS adaptive streaming) | Platform App (browser) |
| Backend / API | Next.js API Routes (REST) | Platform App |
| Database | SQLite via Prisma ORM (dev); PostgreSQL (prod) | Platform App |
| Auth (Admin) | bcrypt-hashed password, HTTP-only session cookie | Platform App |
| Token Generation | Node.js `crypto.randomBytes`, base62, 12 chars | Platform App |
| JWT Library | `jose` (lightweight, standards-compliant) | Platform App + HLS Server |
| HLS Server Framework | Express.js (TypeScript) | HLS Media Server |
| Static File Serving | `express.static` or stream from disk/upstream | HLS Media Server |
| Revocation Cache | Native `Map<string, number>` (in-memory) | HLS Media Server |

---

## 5. Data Model

### 5.1 Event (Streaming Event)

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `title` | String | Human-readable event name (e.g., "Annual Conference 2026") |
| `description` | String (optional) | Event details shown to viewer |
| `streamUrl` | String (optional) | **Deprecated in favor of convention-based paths.** Previously used for per-event upstream URLs. Retained for future flexibility (e.g., third-party origins that don’t follow the event ID convention). If set, overrides the default `UPSTREAM_ORIGIN/:eventId/` path for this specific event. If omitted (recommended), the HLS server derives the upstream path from the event ID automatically. |
| `posterUrl` | String (optional) | Thumbnail/poster image URL |
| `startsAt` | DateTime | Scheduled start time of the live event |
| `endsAt` | DateTime | Scheduled end time of the live event |
| `accessWindowHours` | Integer | Hours after `endsAt` that tokens remain valid for VOD rewatch (default: 48) |
| `isActive` | Boolean | Master toggle to enable/disable all access |
| `isArchived` | Boolean | Hides event from default list views (default: false) |
| `createdAt` | DateTime | Record creation timestamp |
| `updatedAt` | DateTime | Last update timestamp |

### 5.2 Token (Access Ticket)

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `code` | String (unique, indexed) | The 12-character unique token the user enters |
| `eventId` | UUID (FK → Event) | The event/stream this token grants access to |
| `label` | String (optional) | Internal note (e.g., recipient name or batch name) |
| `isRevoked` | Boolean | Manually revoked by admin (default: false) |
| `redeemedAt` | DateTime (nullable) | First use timestamp |
| `redeemedIp` | String (nullable) | IP address of first redemption (for audit) |
| `expiresAt` | DateTime | Computed: `event.endsAt + event.accessWindowHours` |
| `createdAt` | DateTime | Record creation timestamp |

### 5.3 Active Session (Single-Device Enforcement)

Each token supports only **one active viewer at a time**. When a token is validated and a JWT is issued, an active session record is created. A second device attempting to use the same token is blocked until the first session ends.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `tokenId` | UUID (FK → Token) | The token this session belongs to |
| `sessionId` | String (unique, indexed) | Random session identifier (included in JWT `sid` claim) |
| `lastHeartbeat` | DateTime | Last heartbeat timestamp from the player |
| `clientIp` | String | IP address of the active viewer |
| `userAgent` | String (optional) | Browser user-agent string |
| `createdAt` | DateTime | Session creation timestamp |

**Session lifecycle:**
1. **Created** on successful token validation (`POST /api/tokens/validate`) — previous stale sessions for the same token are cleaned up if their `lastHeartbeat` is older than `SESSION_TIMEOUT_SECONDS` (default: 60).
2. **Kept alive** by player heartbeats (`POST /api/playback/heartbeat`) every 30 seconds.
3. **Explicitly released** when the player is closed or the viewer navigates away (`POST /api/playback/release`).
4. **Implicitly expired** if no heartbeat is received within `SESSION_TIMEOUT_SECONDS` — the session is considered abandoned and a new device may claim the token.

The active session is stored in the database (not in-memory) so it survives Platform App restarts and works across horizontally scaled instances.

### 5.4 Access Rules (Platform App — Database Level)

A token grants access if **all** of the following are true:
1. `token.code` exists in the database
2. `token.isRevoked` is `false`
3. `token.event.isActive` is `true`
4. Current time ≤ `token.expiresAt`
5. No other device has an active session for this token (heartbeat within `SESSION_TIMEOUT_SECONDS`)

Rules 1–4 are checked **twice**:
- **On token entry**: Full database validation when the user submits their access code on the Viewer Portal. If valid and no active session exists, a JWT playback token is minted and an active session is created. If an active session exists (another device is watching), the request is rejected with a `409 Conflict` response.
- **On JWT refresh**: Every 50 minutes, the player requests a fresh JWT. The Platform App re-validates rules 1–4 and confirms the session is still owned by the requesting device (via `sid` claim) before issuing a new JWT.

Rule 5 (single-device enforcement) is checked on token entry. On JWT refresh, the server verifies the session ID from the JWT matches the active session for that token.

### 5.5 Access Rules (HLS Media Server — Per-Request Level)

Every HLS request (manifest or segment) is validated by the HLS Media Server:
1. `Authorization: Bearer <JWT>` header is present
2. JWT signature is valid (HMAC-SHA256 with shared secret)
3. JWT has not expired (`exp` claim > current time)
4. Requested URL path starts with the JWT's `sp` (stream path) claim
5. JWT's `sub` (access code) is **not** in the local revocation cache

All five checks are performed in-memory with zero I/O. Total validation time: < 0.1ms.

---

## 6. HLS Media Server

The HLS Media Server is a standalone Express.js (TypeScript) application responsible for serving HLS content with per-request token validation.

### 6.1 Responsibilities

- Serve HLS master playlists (`.m3u8`) and media segments (`.ts` / `.fmp4`)
- Validate JWT playback tokens on **every** HTTP request
- Maintain a local in-memory revocation cache, synced from the Platform App
- Optionally proxy/relay segments from an upstream origin (e.g., a live encoder or cloud storage)

### 6.2 Request Flow

```
Browser (hls.js)                         HLS Media Server
     │                                         │
     │── GET /streams/evt-123/stream.m3u8 ────►│
     │   Authorization: Bearer <JWT>            │
     │                                         │
     │   1. Extract JWT from:                   │
     │      a. Authorization header (preferred)  │
     │      b. __token query param (Safari)      │
     │   2. Verify HMAC-SHA256 signature        │
     │      (shared PLAYBACK_SIGNING_SECRET)     │
     │   3. Check exp > now                     │
     │   4. Check request path starts with      │
     │      JWT claim "sp"                      │
     │   5. Check sub NOT in revocation cache   │
     │                                         │
     │◄── 200 OK + .m3u8 content ──────────────│  (all checks pass)
     │  or                                      │
     │◄── 403 Forbidden ───────────────────────│  (any check fails)
     │                                         │
     │── GET /streams/evt-123/seg-001.ts ─────►│
     │   Authorization: Bearer <JWT>            │
     │   (same validation cycle)                │
     │◄── 200 OK + segment data ───────────────│
```

**Safari native HLS fallback**: Safari’s native HLS implementation does not support custom `Authorization` headers on media requests (it uses its own internal network stack). For Safari users, the JWT must be passed as a `__token` query parameter instead:
- The HLS server accepts JWT from either `Authorization: Bearer <JWT>` header (preferred) or `?__token=<JWT>` query parameter (Safari fallback). Header takes priority if both are present.
- The `__token` parameter is stripped from all server logs and is not included in any cached URLs to prevent token leakage.

### 6.3 Content Sources

The HLS Media Server supports three content source modes (configurable per deployment):

**Mode A: Local File Serving**
- HLS content is stored on the local filesystem under a configurable root directory (e.g., `/var/streams/`)
- Directory structure: `/<eventId>/stream.m3u8`, `/<eventId>/segment-NNN.ts`
- Suitable for: Pre-recorded VOD content, or live streams written to disk by an encoder (e.g., FFmpeg, OBS)
- Configuration: Set `STREAM_ROOT`, omit `UPSTREAM_ORIGIN`

**Mode B: Upstream Proxy (with Persistent Local Caching)**
- HLS content is fetched from an upstream origin URL and relayed to the client
- **Convention-based upstream resolution**: The HLS server constructs the upstream URL as `UPSTREAM_ORIGIN/:eventId/<filename>`. This means the upstream origin must follow the same event ID directory convention. No per-event URL mapping or database access is needed — the event ID from the request path is used directly.
- The HLS server still serves at the convention-based path `/streams/:eventId/` — it maps this internally to `UPSTREAM_ORIGIN/:eventId/`
- **Persistent segment caching**: All segments (`.ts` / `.fmp4`) fetched from the upstream are saved locally to disk under `SEGMENT_CACHE_ROOT/:eventId/`. On subsequent requests for the same segment (e.g., rewind, rewatch, or another viewer), the cached local file is served directly without re-fetching from the upstream.
- **In-flight deduplication**: When multiple viewers request the same uncached segment concurrently, only one upstream fetch is initiated. Other requests wait on the in-flight fetch and are served from the cached result once it completes. Implemented via an in-memory `Map<string, Promise>` keyed by segment path.
- **Manifest caching**: `.m3u8` manifests are **never cached for live streams** (always re-fetched from upstream to ensure the player sees the latest segment references). For VOD content, manifests are cached for 24 hours since they don’t change.
- **Cache benefits**: Eliminates redundant upstream fetches for rewinding/seeking in live streams, enables full VOD-speed seeking after a live event ends (all segments already local), reduces upstream bandwidth costs for concurrent viewers watching the same event
- Suitable for: Live streams from cloud encoders, CDN origins, or third-party streaming platforms
- Configuration: Set `UPSTREAM_ORIGIN` as the base URL (e.g., `https://encoder.example.com/streams`); the HLS server appends `/:eventId/<filename>` automatically

**Mode C: Hybrid (Local First, Upstream Fallback)**
- Server first attempts to serve the requested file from the local filesystem (`STREAM_ROOT`)
- If the file is not found locally, falls back to fetching from the upstream origin (`UPSTREAM_ORIGIN`) and **persistently caches** the fetched segment to `SEGMENT_CACHE_ROOT/:eventId/` (same behavior as Mode B)
- Suitable for: Mixed deployments where some events are local recordings and others are live from an upstream encoder
- Configuration: Set both `STREAM_ROOT` and `UPSTREAM_ORIGIN`

**Segment cache lookup order** (for Mode B and C):
1. Check `STREAM_ROOT/:eventId/` (local files, Mode A / C only)
2. Check `SEGMENT_CACHE_ROOT/:eventId/` (previously fetched from upstream)
3. Fetch from upstream origin (and write to `SEGMENT_CACHE_ROOT/:eventId/` for future requests)

**Segment cache cleanup**: The HLS server runs a periodic cleanup task (configurable interval, default: every 6 hours) that removes cached segments older than `SEGMENT_CACHE_MAX_AGE_HOURS` (default: 72 hours, configurable). This age-based rule is simple and requires no event metadata — the HLS server doesn't need to know event end times or access window durations. An admin can also trigger manual cache cleanup for a specific event via `DELETE /admin/cache/:eventId` (internal, API-key protected).
**Disk space management**:
- `SEGMENT_CACHE_MAX_SIZE_GB` — Maximum total disk space for the segment cache (default: `50`). When the cache exceeds this limit, the least-recently-used (LRU) segments are evicted until the cache is within bounds. LRU is tracked by file access time (`atime`).
- The cleanup task checks disk usage before and after the periodic sweep. If the cache is still over the limit after removing old segments, it evicts the least-recently-used segments until within bounds.
- Each segment write checks the cache size; if over the limit, an async eviction task is queued (does not block the response).
**Configuration validation**: If neither `STREAM_ROOT` nor `UPSTREAM_ORIGIN` is set, the server fails to start with a clear error message.

### 6.4 CORS Configuration

The HLS Media Server must allow cross-origin requests from the Platform App's domain:
- `Access-Control-Allow-Origin`: Set to the Platform App's origin (not `*`)
- `Access-Control-Allow-Headers`: `Authorization, Range`
- `Access-Control-Allow-Methods`: `GET, HEAD, OPTIONS`
- `Access-Control-Max-Age`: `86400` (cache preflight for 24 hours)

### 6.5 Error Responses

| Status | Condition | Body |
|--------|-----------|------|
| `401 Unauthorized` | Missing or malformed Authorization header | `{ "error": "Authorization required" }` |
| `403 Forbidden` | Invalid JWT signature, expired JWT, path mismatch, or revoked token | `{ "error": "Access denied" }` |
| `404 Not Found` | Requested segment/manifest does not exist | `{ "error": "Not found" }` |
| `502 Bad Gateway` | Upstream origin unreachable (proxy mode) | `{ "error": "Stream source unavailable" }` |

Error responses are intentionally vague to avoid leaking internal state to unauthorized clients.

### 6.6 Health & Monitoring

- `GET /health` — Returns `200 OK` with `{ "status": "ok", "revocationCacheSize": N, "lastSyncAgo": "25s", "segmentCacheEvents": N, "segmentCacheSizeMB": N }`. No JWT required.
- Logs: Structured JSON logs for every request (`method`, `path`, `tokenCode` (hashed), `status`, `responseTimeMs`, `clientIp`)
- Metrics (optional): Prometheus-compatible `/metrics` endpoint exposing request count, latency histogram, cache size, sync failures

---

## 7. Viewer Portal (Frontend — Public)

### 7.1 Token Entry Screen

- **Layout**: Centered card on a dark, cinematic background
- **Elements**:
  - Application logo/branding area (configurable)
  - Heading: "Enter Your Access Code"
  - Single text input field (monospace font, uppercase display, auto-trim whitespace)
  - "Watch Now" submit button
  - Subtle helper text: "Enter the code from your ticket"
- **Behavior**:
  - On submit → POST to `/api/tokens/validate` with the entered code
  - **Valid token** → transition to the Player Screen with stream URL + event metadata
  - **Token in use (409)** → inline notification: "This access code is currently being viewed on another device. Please wait for the other session to end before trying again." The user stays on the token entry screen. No retry button is shown — the user must manually re-submit when they believe the other session has ended.
  - **Invalid/expired/revoked token** → inline error message with tiered specificity:
    - **Unknown code**: "Invalid code. Please check your ticket and try again." (vague — does not reveal whether the code ever existed)
    - **Expired code**: "This code has expired. Access was available until [date]." (specific — helps real ticket holders)
    - **Revoked code**: "This code has been revoked. Please contact the event organizer." (specific)
    - **Deactivated event**: "This event is no longer available." (specific)
  - This tiered approach gives real ticket holders useful feedback while preventing attackers from probing whether arbitrary codes exist.
  - Input is rate-limited (max 5 attempts per minute per IP) to prevent brute-force
- **Trigger**: User navigates to the root URL `/`
- **Success criteria**: A valid token transitions to the player within 1 second; invalid tokens show clear, non-technical error messages

### 7.2 Player Screen

- **Layout**: Full-viewport video player with event metadata header
- **Header Bar** (above player):
  - Event title
  - Live indicator badge (pulsing red dot) if stream is currently live
  - "Access expires in X hours" countdown (if < 6 hours remaining)
- **Player**: Full HTML5 video player (see Section 9 for player features)
- **Behavior**:
  - On successful token validation, the Platform API returns a **JWT playback token** and the **HLS Media Server base URL** (e.g., `https://stream.example.com`). The browser constructs the full HLS URL: `<baseUrl>/streams/<eventId>/stream.m3u8`
  - The raw `.m3u8` URL is useless without a valid JWT — the HLS Media Server rejects unauthenticated requests
  - **HLS playback transport (browser-dependent)**:
    - **Non-Safari browsers**: hls.js is configured via `xhrSetup` to attach `Authorization: Bearer <JWT>` to every HLS request (manifests + segments). This header cannot be modified by the user via the player UI.
    - **Safari (macOS & iOS)**: Safari uses its native HLS implementation, which does not allow custom headers on media requests. The player detects Safari and falls back to appending the JWT as a `__token` query parameter on the `.m3u8` URL (e.g., `<baseUrl>/streams/<eventId>/stream.m3u8?__token=<JWT>`). Safari’s native player propagates query parameters to all sub-resource requests (variant playlists and segments). The HLS server accepts the token from either location.
    - **Detection logic**: Check `navigator.vendor.includes('Apple')` and whether the `<video>` element can play HLS natively (`video.canPlayType('application/vnd.apple.mpegurl')`). If both true → use native playback with query parameter token. Otherwise → use hls.js with Authorization header.
  - **JWT auto-refresh**: A background timer calls `POST /api/playback/refresh` every 50 minutes (before the 60-minute JWT expiry), sending the current JWT as `Authorization: Bearer` header. The server extracts the access code from the JWT's `sub` claim and session ID from `sid`, re-validates both. If the refresh succeeds, the new JWT seamlessly replaces the old one for future HLS requests. If it fails (token revoked/expired or session lost), the player transitions to the "access ended" state.
  - **Session heartbeat**: The player sends `POST /api/playback/heartbeat` every 30 seconds with the current JWT as `Authorization: Bearer` header to keep the active session alive. If the heartbeat returns `404` (session timed out) or `409` (session taken by another device), the player pauses playback and shows an overlay message. For `404`: "Your session has expired due to inactivity. Please re-enter your access code." For `409`: "Your session has been started on another device."
  - **Session release on exit**: When the viewer closes the player, navigates away, or the page unloads, the player sends `POST /api/playback/release` to explicitly free the session. This is done via `navigator.sendBeacon()` (or `fetch` with `keepalive: true`) in the `beforeunload` / `visibilitychange` event handler to maximize reliability. If the release fails, the session times out naturally after `SESSION_TIMEOUT_SECONDS` (default: 60s).
  - If the access window expires while the user is watching, show a non-intrusive toast notification 15 minutes before, then overlay a message when expired
  - No navigation away from the player; the back button returns to the token entry screen
- **Trigger**: Successful token validation
- **Success criteria**: Video begins playing (or shows "Waiting for stream to start" if before `startsAt`) within 3 seconds of token validation
- **Segment-level rejection handling**: If the HLS Media Server returns `403` on a segment request (e.g., token was revoked between JWT refreshes), hls.js fires an error event. The player catches this, attempts one JWT refresh, and if that also fails, shows "Your access has been revoked" overlay.

### 7.3 Pre-Event State

If a valid token is entered but the event has not started yet:
- Show event title, description, and scheduled start time
- Display a countdown timer to `startsAt`
- Poll `GET /api/events/:id/status?code=<accessCode>` every 30 seconds to detect when the event goes live (requires the access code to prevent event ID enumeration; does not count against the token validation rate limit)
- Auto-transition to the player and begin playback when the status returns `live`

### 7.4 Post-Event / Recording State

If the event has ended but the token is still within the access window:
- Play the recording from the same stream path (`/streams/:eventId/`). In proxy mode, all previously fetched segments are already cached locally, enabling instant seeking. In local mode, the recording files are served directly from disk.
- Show "Recording" badge instead of "Live"
- Full seek/scrub controls enabled

---

## 8. Admin Console (Backend — Protected)

### 8.1 Admin Authentication

- **Method**: Password-based login (single shared admin password stored as a hashed environment variable)
- **Route**: `/admin` — serves a login form; on success, sets an HTTP-only secure session cookie
- **Session**: Encrypted cookie (stateless) using `iron-session` or equivalent. No server-side session store required. Cookie expiry default: 8 hours. Compatible with serverless deployments (e.g., Vercel).
- **Future upgrade path**: Replace with NextAuth.js + OAuth provider for multi-user admin

### 8.2 Admin Dashboard

- **Layout**: Sidebar navigation + main content area (light theme for readability)
- **Navigation sections**:
  - **Events** — List, create, edit, deactivate streaming events
  - **Tokens** — Generate, list, search, revoke, export tokens
- **Dashboard summary cards** (home view):
  - Total active events
  - Total tokens generated (with breakdown: unused / redeemed / expired / revoked)
  - Upcoming events timeline

### 8.3 Event Management

**Event List View**
- Table: Title, Source (Local/Proxy), Starts At, Ends At, Access Window, Status (Active/Inactive/Archived), Token Count, Actions
- Filters: Active/Inactive/Archived, Upcoming/Past
- Sort by: Start date, title, token count
- Archived events are hidden from the default view; toggle "Show archived" to reveal them

**Create/Edit Event Form**
- Fields: Title, Description, Stream URL Override (optional — only needed if the upstream origin doesn’t follow the convention-based `UPSTREAM_ORIGIN/:eventId/` path; leave blank for standard setups), Poster URL, Start Date/Time, End Date/Time, Access Window (hours, default: 48)
- Validation:
  - If `streamUrl` is provided: must be a syntactically valid URL (format check only — no live probing, since the stream may not exist yet for future events)
  - Start must be before End
  - Access Window must be 1–168 hours (1 week max)
- **"Test Stream" button** (optional convenience): Performs an on-demand HEAD request to the HLS Media Server at `/streams/:eventId/stream.m3u8` to verify the stream is accessible. This is a manual action, not part of form validation. Shows success/failure result inline.
- On save → event is created/updated in database

**Deactivate Event**
- Soft-disable: Sets `isActive = false`, immediately preventing all token access
- Confirmation dialog before deactivation

**Archive Event**
- Hides the event from default list views (`isArchived = true`)
- Archived events and their tokens are preserved in the database
- Can be unarchived at any time
- Confirmation dialog before archiving

**Delete Event**
- **Permanent, irreversible operation** — removes the event and all associated tokens from the database
- Two-step confirmation required:
  1. First click shows a warning dialog: "This will permanently delete the event and all [N] associated tokens. This action cannot be undone."
  2. Admin must type the event title to confirm (prevents accidental deletion)
- Only available for events with no redeemed tokens, OR if the admin explicitly acknowledges data loss
- Audit log records the deletion with event title, token count, and admin timestamp

### 8.4 Token Management

**Generate Tokens**
- **Single generation**: Click "Generate Token" on an event → creates one token, displays the code
- **Batch generation**: Specify quantity (1–500), optional label/batch name → generates N unique tokens for the selected event
- Generated tokens are displayed in a results table with copy-to-clipboard buttons
- **Export**: Download generated tokens as CSV (columns: Code, Event Title, Expires At, Label)

**Token List View**
- Table: Code (monospace), Event Title, Label, Status (Unused / Redeemed / Expired / Revoked), Redeemed At, Expires At, Actions
- Filters: By event, by status
- Search: By token code (partial match) or label
- Pagination: 50 tokens per page

**Token Actions**
- **Revoke**: Immediately invalidates a token; confirmation dialog required
- **Un-revoke**: Restores a previously revoked token (if still within the access window); confirmation dialog required
- **Bulk Revoke**: Select multiple tokens → revoke all; confirmation with count
- **Copy Code**: One-click copy to clipboard

---

## 9. HTML5 Video Player Features

### 9.1 Video Playback Control
- Functionality: Play, pause, and stop video playback
- Purpose: Core control over media consumption
- Trigger: Click on play/pause button or video surface
- Progression: User clicks play → video begins → controls auto-hide after 3s → mouse movement reveals controls → click pause to stop
- Success criteria: Video responds immediately to play/pause commands with smooth state transitions

### 9.2 HLS Stream Support
- Functionality: Automatically detect and play HLS (`.m3u8`) streams using hls.js library
- Purpose: Enable adaptive bitrate streaming for optimal quality
- Trigger: Player receives stream URL after token validation
- Progression: Player detects HLS URL → loads hls.js → attaches to video element → begins adaptive streaming
- Success criteria: HLS streams play seamlessly with automatic quality switching
- **Live stream handling**: When the stream is live, disable the seek bar (or constrain to DVR window if available), show a "LIVE" badge, and auto-seek to the live edge on load

### 9.3 Progress Seeking
- Functionality: Visual timeline showing progress with draggable scrubber
- Purpose: Navigate to any point in the video
- Trigger: Click or drag on progress bar
- Progression: User hovers progress bar → preview appears → user clicks/drags → video seeks to position → playback continues
- Success criteria: Seeking is responsive with accurate time display and smooth scrubbing
- **Live mode**: Seek bar is hidden or shows only the DVR buffer range

### 9.4 Volume Control
- Functionality: Adjustable volume slider with mute toggle
- Purpose: User audio preference control
- Trigger: Click volume icon or drag slider
- Progression: User clicks volume icon → slider appears → drag to adjust → volume changes in real-time → click icon to mute/unmute
- Success criteria: Volume adjustments are immediate with visual feedback; mute state persists across sessions (localStorage)

### 9.5 Fullscreen Mode
- Functionality: Toggle fullscreen viewing using the Fullscreen API
- Purpose: Immersive viewing experience
- Trigger: Click fullscreen button or double-click video
- Progression: User clicks fullscreen → video expands to fill screen → controls overlay on hover → ESC or button exits fullscreen
- Success criteria: Smooth transition to/from fullscreen with controls remaining accessible
- **Mobile**: Automatically enter fullscreen in landscape orientation (with user gesture)

### 9.6 Time Display
- Functionality: Shows current time and total duration
- Purpose: Inform user of playback position
- Trigger: Video metadata loads
- Progression: Video loads → duration detected → displays as "0:00 / 5:23" → updates as video plays
- Success criteria: Time displays accurately in readable format (MM:SS or HH:MM:SS for videos ≥ 1 hour)

### 9.7 Quality Selector (Adaptive Bitrate)
- Functionality: Allow the user to manually select a stream quality level or leave on "Auto"
- Purpose: Give users control when bandwidth is limited or they prefer a specific quality
- Trigger: Click quality badge/button in the control bar
- Options: "Auto" (default) + each available rendition (e.g., 1080p, 720p, 480p, 360p)
- Success criteria: Quality switch happens within 2 seconds without playback interruption

### 9.8 Picture-in-Picture
- Functionality: Toggle PiP mode where supported by the browser
- Purpose: Allow multitasking while watching
- Trigger: Click PiP button in control bar
- Success criteria: Video continues playing in a floating window; controls remain functional

---

## 10. API Endpoints

### 10.1 Platform App — Public API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tokens/validate` | Validate an access code; returns event metadata + JWT playback token |
| POST | `/api/playback/refresh` | Refresh an expiring JWT playback token (requires current JWT as Bearer auth) |
| POST | `/api/playback/heartbeat` | Keep the active viewing session alive (requires current JWT as Bearer auth) |
| POST | `/api/playback/release` | Release the active viewing session, freeing the token for another device |
| GET | `/api/events/:id/status` | Event status check (requires `code` query param); not rate-limited |

**POST `/api/tokens/validate`**

Request body: `{ "code": "ABCDEF123456" }`

Success response (200):
```json
{
  "event": {
    "title": "Annual Conference 2026",
    "description": "...",
    "startsAt": "2026-03-10T14:00:00Z",
    "endsAt": "2026-03-10T18:00:00Z",
    "posterUrl": "https://...",
    "isLive": true
  },
  "playbackToken": "eyJhbGciOiJIUzI1NiIs...",
  "playbackBaseUrl": "https://stream.example.com",
  "streamPath": "/streams/evt-uuid/stream.m3u8",
  "expiresAt": "2026-03-12T14:00:00Z",
  "tokenExpiresIn": 3600
}
```

- `playbackToken` — JWT to attach as `Authorization: Bearer` header on HLS requests
- `playbackBaseUrl` — Base URL of the HLS Media Server
- `streamPath` — Path to the HLS manifest on the HLS Media Server
- `tokenExpiresIn` — Seconds until the JWT expires (client uses this to schedule refresh)
- `isLive` — Determined via **stream probing**: the Platform App mints a short-lived **probe JWT** (10-second expiry, with a special `"probe": true` claim that restricts it to HEAD requests only) and sends a HEAD request to the HLS Media Server’s `.m3u8` manifest with this JWT. The HLS server validates the probe JWT normally but only allows HEAD method when the `probe` claim is present. The Platform App checks if the manifest is actively being updated (recent `Last-Modified` timestamp or changing `ETag`). Falls back to time-based check (`now >= startsAt && now <= endsAt`) if the probe fails.

Error responses:
- `401` — Invalid token code
- `403` — Token revoked or event deactivated
- `409` — Token is currently in use on another device (see single-device enforcement below)
- `410` — Token expired
- `429` — Rate limit exceeded

**409 response (token in use):**
```json
{
  "error": "This access code is currently in use on another device.",
  "inUse": true
}
```
The response intentionally does not reveal details about the other device (IP, user-agent) to prevent information leakage. The viewer must wait for the other session to end (either by the other viewer closing the player, or by session timeout after 60 seconds of inactivity) before they can start watching.

**POST `/api/playback/refresh`**

Request headers: `Authorization: Bearer <current-JWT>` (the nearly-expired JWT)

Request body: *(none — the access code is extracted from the JWT's `sub` claim)*

Success response (200):
```json
{
  "playbackToken": "eyJhbGciOiJIUzI1NiIs...",
  "tokenExpiresIn": 3600
}
```

Error responses: Same as `/api/tokens/validate` (except `409`). The refresh endpoint verifies the current JWT's signature, extracts the access code from `sub` and the session ID from `sid`, confirms the session is still active and belongs to the requesting device, and performs a full re-validation against the database before issuing a new JWT with the same `sid`.

**POST `/api/playback/heartbeat`**

Keeps the active viewing session alive. The player calls this every 30 seconds.

Request headers: `Authorization: Bearer <current-JWT>`

Request body: *(none — the session ID is extracted from the JWT's `sid` claim)*

Success response (200):
```json
{
  "ok": true
}
```

Error responses:
- `401` — Missing or invalid JWT
- `404` — Session not found (expired or released)
- `409` — Session has been taken over by another device (race condition edge case)

If the heartbeat returns `404` or `409`, the player should show an appropriate message and stop playback. A `404` means the session timed out (the viewer was inactive too long), and they can re-enter their token code to start a new session. A `409` means another device claimed the token after the session timed out.

**POST `/api/playback/release`**

Explicitly releases the active viewing session, freeing the token for use on another device.

Request headers: `Authorization: Bearer <current-JWT>`

Request body: *(none — the session ID is extracted from the JWT's `sid` claim)*

Success response (200):
```json
{
  "released": true
}
```

Error responses:
- `401` — Missing or invalid JWT

This endpoint is called on `beforeunload` / `visibilitychange` (page close or navigation away) and when the viewer explicitly stops the player. It is fire-and-forget — if the request fails (e.g., network loss), the session will time out naturally after `SESSION_TIMEOUT_SECONDS`.

**GET `/api/events/:id/status`**

Returns the current status of an event based on **stream probing** (checking whether the HLS stream is actively being written to on the HLS Media Server).

Query parameters:
- `code` (required) — A valid access code for the event. The server validates that the code exists and is associated with the given event ID (but does not count this as a token validation attempt for rate-limiting purposes).

Response (200):
```json
{
  "eventId": "evt-uuid",
  "status": "live",
  "startsAt": "2026-03-10T14:00:00Z",
  "endsAt": "2026-03-10T18:00:00Z"
}
```

Possible `status` values:
- `"not-started"` — Event has not started yet (current time < `startsAt` and no active stream detected)
- `"live"` — Stream is actively being written to (detected via HEAD request to the `.m3u8` manifest on the HLS Media Server, checking for recent `Last-Modified` or `ETag` changes)
- `"ended"` — Event has ended (current time > `endsAt` or stream is no longer being updated)
- `"recording"` — Event has ended but stream content is still available for VOD playback

Error responses:
- `401` — Invalid or missing access code
- `404` — Event not found

This endpoint requires a valid access code to prevent event ID enumeration. It is not rate-limited (the code check is lightweight) making it safe for frequent polling from the pre-event countdown screen.

### 10.2 Platform App — Admin API (all require authenticated admin session)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | Authenticate admin (body: `{ password }`) |
| POST | `/api/admin/logout` | End admin session |
| GET | `/api/admin/events` | List all events (with filters, pagination) |
| POST | `/api/admin/events` | Create a new event |
| GET | `/api/admin/events/:id` | Get event details |
| PUT | `/api/admin/events/:id` | Update an event |
| PATCH | `/api/admin/events/:id/deactivate` | Deactivate an event |
| PATCH | `/api/admin/events/:id/reactivate` | Reactivate a previously deactivated event |
| PATCH | `/api/admin/events/:id/archive` | Archive an event (hide from default views) |
| PATCH | `/api/admin/events/:id/unarchive` | Unarchive an event |
| DELETE | `/api/admin/events/:id` | Permanently delete an event and all its tokens |
| GET | `/api/admin/events/:id/tokens` | List tokens for an event |
| POST | `/api/admin/events/:id/tokens/generate` | Generate tokens (body: `{ count, label }`) |
| GET | `/api/admin/tokens` | List all tokens (with filters, search, pagination) |
| PATCH | `/api/admin/tokens/:id/revoke` | Revoke a single token |
| PATCH | `/api/admin/tokens/:id/unrevoke` | Un-revoke a previously revoked token |
| POST | `/api/admin/tokens/bulk-revoke` | Revoke multiple tokens (body: `{ tokenIds: [] }`) |
| GET | `/api/admin/events/:id/tokens/export` | Export tokens for a specific event as CSV |
| GET | `/api/admin/dashboard` | Dashboard summary statistics |

### 10.3 Platform App — Internal API (called by HLS Media Server)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/revocations?since=<ISO8601>` | Returns tokens revoked since the given timestamp |

**GET `/api/revocations`**

Query parameters:
- `since` (required) — ISO 8601 timestamp. Returns only revocations and event deactivations after this time.

Response (200):
```json
{
  "revocations": [
    { "code": "ABCDEF123456", "revokedAt": "2026-03-10T15:30:00Z" },
    { "code": "GHIJKL789012", "revokedAt": "2026-03-10T15:32:00Z" }
  ],
  "eventDeactivations": [
    { "eventId": "evt-uuid", "deactivatedAt": "2026-03-10T15:33:00Z", "tokenCodes": ["MNOPQR345678", "STUVWX901234"] }
  ],
  "serverTime": "2026-03-10T15:35:00Z"
}
```

- `revocations` — Individually revoked tokens since the given timestamp
- `eventDeactivations` — Events that were deactivated since the given timestamp, with all their associated token codes (the HLS server adds these codes to its revocation cache to block access immediately)

Authentication: This endpoint is protected with a shared API key (`X-Internal-Api-Key` header) rather than admin session auth, since it's called server-to-server.

### 10.4 HLS Media Server — Streaming API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/streams/:eventId/stream.m3u8` | Serve HLS master playlist (JWT required) |
| GET | `/streams/:eventId/*.m3u8` | Serve HLS variant/media playlists (JWT required) |
| GET | `/streams/:eventId/*.ts` | Serve HLS media segments (JWT required) |
| GET | `/streams/:eventId/*.fmp4` | Serve fMP4 segments if applicable (JWT required) |
| GET | `/health` | Health check (no auth required) |
| DELETE | `/admin/cache/:eventId` | Clear cached segments for an event (API key required) |

---

## 11. Edge Case Handling

### Player Edge Cases
- **Safari native HLS**: Safari has native HLS support — detect and use native playback instead of hls.js. Since Safari’s native player cannot inject custom `Authorization` headers, the JWT is passed via `__token` query parameter on the manifest URL. Safari propagates query parameters to sub-resource requests (variant playlists and segments). See Section 7.2 for detection logic and Section 6.2 for server-side token extraction.
- **Network Interruption**: Display loading indicator during buffering; show reconnection message with auto-retry (exponential backoff, max 5 retries) if stream fails
- **Invalid Stream URL**: Show friendly error: "Stream is not available. Please try again later."
- **Very Long Videos**: Time display automatically formats to include hours (HH:MM:SS) when needed
- **Mobile Touch Devices**: Controls remain visible longer; tap to show/hide; double-tap to seek ±10 seconds
- **Audio-only Streams**: Display poster image or event branding instead of black screen

### Token & Access Edge Cases
- **Token used from multiple devices simultaneously (single-device enforcement)**: Only **one device may actively view a stream per token** at any time. When a token is validated and a JWT is issued, an active session is created in the database. If a second device attempts to validate the same token while an active session exists (heartbeat received within `SESSION_TIMEOUT_SECONDS`, default: 60s), the second device receives a `409 Conflict` response with a message indicating the token is currently in use. The second device **cannot** start playback until the first device's session ends — either by explicit release (player closed/navigated away) or by session timeout (no heartbeat for 60 seconds). There is no option to forcibly take over the session from the second device. The first viewer must stop watching before the second device can use the token. All session activity (creation, heartbeats, release, timeout) is logged with IP and user-agent for audit.
- **Access expires mid-viewing**: Show a warning toast 15 minutes before expiry. On expiry, overlay a "Your access has ended" message but do not abruptly cut playback mid-sentence — allow a 60-second grace period.
- **Brute-force token guessing**: Rate-limit the validation endpoint to 5 requests/minute per IP. Error responses use tiered specificity: expired/revoked/deactivated codes get helpful messages (for real ticket holders), but unknown codes get a vague "Invalid code" message (prevents probing for valid codes).
- **Token entered before event starts**: Show pre-event waiting screen with countdown (Section 7.3).
- **Event deactivated while user is watching**: Within 30 seconds, the HLS Media Server's revocation cache picks up the event deactivation (via the revocation sync endpoint which now includes event deactivations). The viewer's next segment request gets a 403. The player attempts one JWT refresh, which also fails (event is inactive), and shows "This event is no longer available" overlay.
- **Batch generation of duplicate tokens**: Token generation uses cryptographically random values with uniqueness constraint in the database; collisions are retried automatically.
- **Admin session expires during bulk operation**: Operations are atomic server-side; partial completions are not possible.

---

## 12. Security Considerations

1. **Token entropy**: 12-character base62 tokens = ~71 bits of entropy (~2.3 × 10²¹ possible values). Brute-force infeasible at 5 req/min rate limit.
2. **Two-layer stream protection**:
   - **Layer 1 (Platform App)**: Access code validated against database. On success, a short-lived JWT (1 hour) is issued.
   - **Layer 2 (HLS Media Server)**: Every HLS request (manifest + segment) requires a valid JWT in the `Authorization` header. The raw stream URL is useless without a JWT.
3. **JWT security**:
   - Algorithm: HMAC-SHA256 (symmetric, no key distribution complexity)
   - Short-lived: 1-hour expiry prevents long-term token theft
   - Path-scoped: JWT `sp` claim restricts access to a specific stream path, preventing one JWT from accessing another event’s content
   - Refresh-gated: JWT refresh requires the current JWT as Bearer auth (not just an access code), re-validates against the database, so revoked/expired access codes cannot obtain new JWTs. This also prevents the refresh endpoint from being used as an alternative validation endpoint.
4. **Revocation speed**: Maximum 30-second delay between admin revoking a token (or deactivating an event) and the HLS server blocking requests, via the revocation cache sync which includes both individual revocations and event deactivations. JWT expiry provides a hard 1-hour backstop regardless.
5. **Admin authentication**: Admin password is stored as a bcrypt hash in environment variables. Session cookies are HTTP-only, Secure, SameSite=Strict.
6. **Internal API security**: The `/api/revocations` endpoint (called by HLS server) is protected with a shared API key (`X-Internal-Api-Key` header), not exposed publicly.
7. **Rate limiting**: Applied to token validation endpoint (5/min per IP), playback refresh (12/hour per token code), and admin login (10/min per IP).
8. **Input sanitization**: All user inputs (token codes, event fields) are validated and sanitized server-side. Token codes are alphanumeric only (reject any non-alphanumeric characters).
9. **HTTPS only**: Both the Platform App and HLS Media Server must be served over HTTPS in production. HSTS headers enabled on both.
10. **CORS**: Platform App API restricted to same-origin. HLS Media Server allows requests only from the Platform App’s origin.
11. **Audit logging**: All token validations (success and failure), JWT issuances, JWT refreshes, session creation/release/timeout, and admin actions are logged with timestamp, IP, and action type on the Platform App. The HLS server logs all access attempts with hashed token codes (never raw codes).
12. **Safari query parameter token**: When JWT is passed as `__token` query parameter (Safari fallback), the HLS server strips the parameter from any logged URLs and does not cache the URL with the token in it.
13. **Single-device enforcement**: Each token supports only one active viewing session at a time. Session state is stored in the database (not in-memory) to survive restarts and work across horizontally scaled Platform App instances. The session timeout (`SESSION_TIMEOUT_SECONDS`, default: 60) balances security (preventing indefinite session locks from crashed browsers) with usability (not timing out active viewers on slow connections). The heartbeat interval (30s) is set to roughly half the timeout to provide at least one retry window before timeout. The `409 Conflict` response for "token in use" does not reveal any details about the other device to prevent information leakage.

---

## 13. Responsive Design & Browser Compatibility

### 13.1 Supported Browsers
- Chrome 90+ (Desktop & Android)
- Firefox 90+ (Desktop & Android)
- Safari 14+ (macOS & iOS)
- Edge 90+ (Desktop)
- Samsung Internet 15+

### 13.2 Responsive Breakpoints

| Breakpoint | Width | Layout Behavior |
|-----------|-------|----------------|
| Mobile Portrait | < 480px | Single column; player fills width; controls stacked vertically; token input full-width |
| Mobile Landscape | 480–767px | Player fills viewport; controls overlay; auto-fullscreen prompt |
| Tablet | 768–1023px | Comfortable padding; side-by-side elements where appropriate |
| Desktop | 1024–1439px | Centered content with max-width constraint |
| Large Desktop | ≥ 1440px | Same as Desktop with larger max-width |

### 13.3 Orientation Handling
- **Portrait → Landscape**: Prompt user to rotate for better viewing; optionally auto-enter fullscreen (with user gesture on mobile)
- **Landscape → Portrait**: Exit fullscreen gracefully; re-layout controls for portrait
- **Orientation lock**: Not enforced (respect user's device settings)

### 13.4 Touch & Input Support
- Touch: Tap to play/pause, swipe on progress bar, pinch-to-zoom disabled on player
- Keyboard: Space (play/pause), F (fullscreen), M (mute), Arrow keys (seek ±10s, volume ±10%)
- Screen readers: ARIA labels on all controls; live region announcements for state changes

---

## 14. Design Direction

The design should evoke a premium, cinematic experience — sophisticated controls that feel professional yet approachable, with smooth animations that enhance rather than distract from the viewing experience. The token entry screen should feel like a VIP gateway: exclusive, clean, and confidence-inspiring.

### 14.1 Color Selection

A dark, cinema-inspired palette for the Viewer Portal; a clean, functional palette for the Admin Console.

**Viewer Portal (Dark Theme)**
- **Primary Color**: Deep cinematic black (oklch(0.15 0 0)) — Creates professional theater atmosphere
- **Secondary Colors**: Charcoal gray (oklch(0.25 0 0)) for control backgrounds, slate gray (oklch(0.35 0 0)) for hover states
- **Accent Color**: Electric blue (oklch(0.65 0.19 250)) — Modern, energetic highlight for interactive elements and progress
- **Live Badge**: Vibrant red (#EF4444) with pulsing animation
- **Foreground/Background Pairings**:
  - Primary (Deep Black #1E1E1E): White text (#FFFFFF) — Ratio 16.2:1 ✓
  - Secondary (Charcoal #2E2E2E): White text (#FFFFFF) — Ratio 13.8:1 ✓
  - Accent (Electric Blue #3B82F6): White text (#FFFFFF) — Ratio 5.1:1 ✓

**Admin Console (Light Theme)**
- **Background**: White (#FFFFFF) with subtle gray (#F9FAFB) section backgrounds
- **Text**: Near-black (#111827) for headings, dark gray (#374151) for body
- **Accent**: Same electric blue for consistency with viewer branding
- **Status colors**: Green (#22C55E) for active/redeemed, amber (#F59E0B) for unused, red (#EF4444) for revoked/expired

### 14.2 Font Selection

- **Typographic Hierarchy**:
  - Headings: Inter SemiBold / 24–32px
  - Body text: Inter Regular / 14–16px
  - Token codes: JetBrains Mono Medium / 18px / letter-spacing: 0.15em (for readability and to prevent confusion between similar characters)
  - Time Display: JetBrains Mono Medium / 14px / tabular numbers
  - Button Labels: Inter Medium / 14px
  - Error Messages: Inter Regular / 15px

### 14.3 Animations

- Controls fade in/out smoothly (200–300ms ease-out)
- Progress bar seeking has subtle spring physics
- Fullscreen transitions are seamless
- Hover states respond in 100ms (immediate feel)
- Token validation: subtle loading spinner on button → success checkmark animation → smooth transition to player
- Live badge: Pulsing red dot (CSS animation, 2s interval)
- Countdown timer: Smooth number transition (no flicker)

---

## 15. Component Selection

### 15.1 Shared Components
- **Button** (shadcn): All action buttons with primary/secondary/destructive variants
- **Input** (shadcn): Token entry, search fields, form inputs
- **Card** (shadcn): Container for token entry, event cards, dashboard statistics
- **Alert** (shadcn): Error states, warnings, success confirmations
- **Badge** (shadcn): Status indicators (Live, Recording, Active, Expired, Revoked)
- **Dialog** (shadcn): Confirmation dialogs for destructive actions
- **Table** (shadcn): Token lists, event lists in admin
- **Pagination** (custom): Page navigation for token/event lists
- **Toast** (shadcn): Non-intrusive notifications (access expiry warning, copy confirmation)

### 15.2 Player Components
- **Slider** (shadcn): Progress bar and volume control with custom track styling
- Custom `VideoControls` component with auto-hide behavior using Framer Motion
- Custom `TimeDisplay` component with formatted time strings
- Custom `FullscreenToggle` handling browser Fullscreen API
- Custom `QualitySelector` dropdown for HLS rendition selection
- Custom `LiveBadge` with pulsing animation

### 15.3 Component States
- Play/Pause button: Morphs between icons with rotation animation
- Volume: Shows/hides slider on hover; mute icon changes when muted
- Progress: Thumb enlarges on hover/drag; shows tooltip with time preview
- Fullscreen: Icon changes based on fullscreen state
- Loading: Subtle spinner overlay when buffering
- Token input: Neutral → loading (spinner) → success (checkmark) → error (red border + message)

### 15.4 Icon Selection (Lucide React)
- Play/Pause: `Play` / `Pause`
- Volume: `Volume2` / `VolumeX`
- Fullscreen: `Maximize` / `Minimize`
- Loading: `Loader2` with rotation animation
- Live: `Radio` (with pulsing dot)
- Copy: `Copy` / `Check` (on success)
- Revoke: `Ban`
- Export: `Download`
- Generate: `Plus` / `Sparkles`

### 15.5 Spacing
- Container padding: `p-4` for breathing room
- Control bar: `px-6 py-4` for comfortable touch targets
- Button gaps: `gap-2` for related controls, `gap-4` for groups
- Progress bar margin: `my-2` for separation from other controls
- Token input: `max-w-md mx-auto` centered with generous vertical padding

### 15.6 Mobile Adaptations
- Stacked layout on mobile: progress bar spans full width above controls
- Larger touch targets: `min-h-12` for all interactive elements
- Volume slider: Converts to popover on mobile instead of inline
- Controls always visible on mobile with translucent background for readability
- Token entry: Full-width input with large text size for easy thumb typing

---

## 16. User Flows

### 16.1 Viewer: Redeem Token and Watch

```
1. User receives token via email/print/QR
2. User navigates to the Viewer Portal URL
3. User enters or pastes the token code
4. Platform App validates the token against the database and checks for active sessions
5. Platform App creates an active session record and mints a JWT playback token (1-hour expiry, includes session ID) and returns:
   - JWT, HLS Media Server base URL, stream path, event metadata
6. Browser constructs HLS URL and configures hls.js with JWT in Authorization header
7a. If event is live → Player loads with live stream, "LIVE" badge shown
7b. If event hasn’t started → Countdown screen shown, auto-starts when live
7c. If event has ended but token valid → Player loads recording with full seek
8. Every HLS segment request: HLS Media Server verifies JWT (sub-ms)
9. Every 30 seconds: Player sends heartbeat to keep session alive
10. Every 50 minutes: Player auto-refreshes JWT via Platform App (sends current JWT as Bearer auth)
11. If access nearing expiry → Toast warning shown
12. On token expiry → JWT refresh fails → "Access ended" overlay
13. On player close / navigation away → Session released via POST /api/playback/release
```

### 16.2 Viewer: Second Device Attempts Same Token

```
1. Device A is actively watching a stream using token ABCDEF123456
   (Session is active, heartbeats being sent every 30s)
2. User opens Device B and navigates to the Viewer Portal
3. User enters the same token code ABCDEF123456
4. Platform App finds an active session for this token (heartbeat within 60s)
5. Platform App responds with 409 Conflict: "This access code is currently in use on another device."
6. Device B shows the "in use" message on the token entry screen
7. User must wait for Device A to stop watching:
   7a. Device A viewer closes the player → session released immediately
   7b. Device A loses network / crashes → session times out after 60s of no heartbeats
8. User re-enters the token on Device B
9. No active session exists → validation succeeds → new session created for Device B
10. Device B begins streaming
```

### 16.3 Admin: Create Event and Distribute Tokens

```
1. Admin navigates to /admin and logs in
2. Admin creates a new Event (title, stream URL, schedule, access window)
3. Admin navigates to the event's token section
4. Admin clicks "Generate Tokens" → enters count (e.g., 200) and optional label
5. System generates 200 unique tokens and displays them
6. Admin exports tokens as CSV
7. Admin distributes tokens via their preferred channel (email, print, etc.)
```

### 16.4 Admin: Revoke Access

```
1. Admin searches for a token by code or browses the token list
2. Admin selects one or more tokens
3. Admin clicks "Revoke" → confirmation dialog
4. Tokens are immediately marked as revoked in the database
5. Within 30 seconds: HLS Media Server’s revocation cache picks up the revocation
6. Next segment request from the affected viewer gets a 403
7. Viewer’s player attempts JWT refresh → refresh fails → "Access revoked" overlay
```

---

## 17. Out of Scope (v1)

The following are explicitly **not** included in this version but noted as potential future enhancements:

- Token delivery system (email sending, QR code generation) — handled externally
- User accounts or registration — access is purely token-based
- Chat or live interaction features alongside the stream
- Multi-language / i18n support
- Analytics dashboard (viewer count, watch duration, geographic data)
- DRM (Digital Rights Management) — relies on JWT validation and token expiry for access control
- Multi-admin roles and permissions — single admin password for v1
- Payment / ticketing integration — tokens are generated manually by admin
- Stream ingestion/transcoding — streams are provided as pre-existing HLS files or upstream origins
- CDN integration — the HLS Media Server serves content directly; a CDN layer can be added in front with JWT pass-through
- Adaptive bitrate packaging — assumes HLS content is already packaged with multiple variants
- HLS encryption (AES-128 / SAMPLE-AES) — content-level encryption is not managed by this system; access control is enforced at the HTTP layer via JWT

---

## 18. Deployment Considerations

The platform consists of two independently deployable services that share a signing secret and communicate via a single REST endpoint.

### 18.1 Platform App (Next.js)

- **Platform**: Vercel (recommended for Next.js) or any Node.js hosting
- **Database**: SQLite file for development and small-scale; PostgreSQL (via Prisma migration) for production scale
- **Port**: Default `3000` (configurable)
- **Environment Variables**:
  - `ADMIN_PASSWORD_HASH` — bcrypt hash of the admin password
  - `PLAYBACK_SIGNING_SECRET` — HMAC secret for JWT playback tokens (**must match** HLS server)
  - `INTERNAL_API_KEY` — API key for the `/api/revocations` endpoint
  - `DATABASE_URL` — Database connection string
  - `HLS_SERVER_BASE_URL` — Public URL of the HLS Media Server (returned to browser in token validation response)
  - `NEXT_PUBLIC_APP_NAME` — Configurable branding name
  - `SESSION_TIMEOUT_SECONDS` — How long (in seconds) before an inactive viewing session is considered abandoned (default: `60`). A session with no heartbeat for this duration can be claimed by another device.

### 18.2 HLS Media Server (Express.js)

- **Platform**: Any Node.js hosting, VPS, or container runtime (Docker recommended)
- **Port**: Default `4000` (configurable)
- **Environment Variables**:
  - `PLAYBACK_SIGNING_SECRET` — HMAC secret for JWT verification (**must match** Platform App)
  - `PLATFORM_APP_URL` — Base URL of the Platform App (for revocation polling)
  - `INTERNAL_API_KEY` — API key for authenticating to the Platform App’s revocation endpoint
  - `STREAM_ROOT` — Local filesystem path for stream files (Mode A) or omitted if using proxy-only mode
  - `SEGMENT_CACHE_ROOT` — Local filesystem path for persistently cached upstream segments (Mode B/C). Defaults to `STREAM_ROOT/cache/` if `STREAM_ROOT` is set, otherwise required for proxy mode. Segments fetched from the upstream origin are saved here and served locally on subsequent requests.
  - `UPSTREAM_ORIGIN` — Upstream HLS origin URL base (e.g., `https://encoder.example.com/streams`). The server appends `/:eventId/<filename>` automatically (convention-based). Omit if using local-only mode.
  - **Content source resolution**: If both `STREAM_ROOT` and `UPSTREAM_ORIGIN` are set, the server attempts to serve from local files first. If the requested file is not found locally, it falls back to the upstream origin (hybrid mode). If neither is set, the server fails to start with a configuration error.
  - `SEGMENT_CACHE_MAX_SIZE_GB` — Maximum disk space for the segment cache in GB (default: `50`). LRU eviction when exceeded.
  - `SEGMENT_CACHE_MAX_AGE_HOURS` — Maximum age for cached segments in hours (default: `72`). Segments older than this are deleted by the periodic cleanup task.
  - `REVOCATION_POLL_INTERVAL_MS` — Polling interval in milliseconds (default: `30000`)
  - `CORS_ALLOWED_ORIGIN` — Platform App origin for CORS headers
  - `PORT` — Listening port (default: `4000`)

### 18.3 Deployment Topology Options

**Option A: Co-located (Development / Small Scale)**
```
┌───────────────────────────────┐
│       Single Server / VPS        │
│                                  │
│  Platform App   :3000            │
│  HLS Server     :4000            │
│  SQLite DB      ./data/db.sqlite │
│  Stream Files   ./streams/       │
└───────────────────────────────┘
```
Both services run on the same machine. The HLS server polls `http://localhost:3000/api/revocations`. Simplest setup; suitable for development and events with < 500 concurrent viewers.

**Option B: Separated (Production)**
```
┌─────────────────┐     ┌────────────────────┐
│  Vercel / App   │     │  Streaming Server    │
│  Platform       │     │  (VPS / Docker)       │
│                 │     │                       │
│  Platform App   │◄────│  HLS Media Server    │
│  PostgreSQL     │poll │  Stream Files / Proxy │
└─────────────────┘     └────────────────────┘
```
Platform App on Vercel (or similar PaaS) with PostgreSQL. HLS server on a separate machine with high bandwidth and local SSD for segment storage. Suitable for large-scale events.

**Option C: Edge / Multi-Region**
```
┌─────────────┐
│ Platform App  │
│ (Central)     │
└──────┬──────┘
       │ revocation sync
  ┌────┼───────────┐
  │    │            │
  ▼    ▼            ▼
 HLS   HLS         HLS
 (US)  (EU)        (APAC)
```
Multiple HLS server instances across regions, all sharing the same `PLAYBACK_SIGNING_SECRET` and independently polling the central Platform App for revocations. JWT verification is local (no cross-region latency). Suitable for global audiences.

### 18.4 Scaling Considerations

- **Platform App**: Stateless API design allows horizontal scaling. Database is the single bottleneck; migrate to PostgreSQL + connection pooling for > 1,000 concurrent viewers.
- **HLS Media Server**: CPU-bound JWT verification scales linearly with cores. Typical commodity hardware can handle ~50,000 JWT verifications per second per core. I/O bound by disk read or upstream fetch for segment data. A single server with SSD storage can serve ~5,000 concurrent viewers.
- **Revocation sync**: Each HLS server instance polls independently. With N instances, the Platform App receives N requests every 30 seconds — negligible load even at 100+ instances.