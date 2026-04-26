---
sidebar_position: 1
title: Architecture Overview
---

# Architecture Overview

StreamGate is a **ticket-gated video streaming platform** composed of two independently deployable services and a shared library, all managed in a single monorepo with npm workspaces.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Viewer)                        │
│                                                                 │
│  ┌────────────────────┐          ┌────────────────────────────┐ │
│  │  Viewer Portal     │          │  HLS Player (hls.js)       │ │
│  │  POST /api/tokens/ │          │  GET /streams/:eventId/    │ │
│  │     validate       │          │    *.m3u8, *.ts            │ │
│  └────────┬───────────┘          └──────────┬─────────────────┘ │
│           │                                 │                   │
│           │ Access Code                     │ Authorization:    │
│           │                                 │ Bearer <JWT>      │
└───────────┼─────────────────────────────────┼───────────────────┘
            │                                 │
            ▼                                 ▼
┌───────────────────────┐       ┌──────────────────────────────┐
│   Platform App        │       │   HLS Media Server           │
│   (Next.js :3000)     │       │   (Express :4000)            │
│                       │       │                              │
│  • Viewer Portal      │       │  • JWT validation (HMAC)     │
│  • Admin Console      │       │  • .m3u8/.ts file serving    │
│  • API Routes         │       │  • Revocation cache (Map)    │
│  • Token management   │       │  • Segment caching           │
│  • JWT issuance       │       │  • Upstream proxy            │
│  • Session tracking   │       │                              │
│  • Prisma + SQLite/PG │       │  No database required        │
└───────────┬───────────┘       └──────────┬───────────────────┘
            │                              │
            │  GET /api/revocations?since=  │
            │  (X-Internal-Api-Key header)  │
            │◄─────────────────────────────┘
            │         Every 30 seconds
            │
┌───────────┴───────────┐
│  @streaming/shared    │
│  (TypeScript package) │
│                       │
│  • Type definitions   │
│  • Constants (PDR)    │
│  • JWT utilities      │
│  • Validation helpers │
└───────────────────────┘
```

## Service Communication

| From | To | Protocol | Purpose |
|------|----|----------|---------|
| Browser | Platform App | HTTPS (REST) | Token validation, JWT issuance/refresh, heartbeat, session release |
| Browser | HLS Server | HTTPS (HLS) | Stream manifest (.m3u8) and segment (.ts) requests with JWT Bearer |
| HLS Server | Platform App | HTTP (REST) | Poll `GET /api/revocations?since=` every 30s for revoked tokens and deactivated events |
| HLS Transcoder | Platform App | HTTP (REST) | Fetch stream config on `publish_start` via `GET /api/internal/events/:id/stream-config`; cache system defaults via `GET /api/internal/stream-config/defaults` |
| Platform App | HLS Server | HTTP (HEAD) | Stream probing — check if a stream is live using a short-lived probe JWT |
| Admin Browser | Platform App | HTTPS (REST) | Event/token CRUD via `/api/admin/*` with session cookie auth |

:::info Key Isolation Principle
The HLS Media Server has **zero database access**. It verifies JWTs using only the shared HMAC secret (`PLAYBACK_SIGNING_SECRET`) and maintains an in-memory revocation cache updated by polling. This separation enables the HLS server to handle thousands of concurrent streaming requests with sub-millisecond auth overhead.
:::

## JWT Playback Token Design

### Claims Structure

```typescript
interface PlaybackTokenClaims {
  sub: string;    // Access token code (e.g., "Ab3kF9mNx2Qp")
  eid: string;    // Event ID (UUID)
  sid: string;    // Active session ID (for single-device enforcement)
  sp: string;     // Allowed stream path prefix (e.g., "/streams/evt-uuid/")
  iat: number;    // Issued at (Unix timestamp)
  exp: number;    // Expires at (Unix timestamp, iat + 3600)
  probe?: boolean; // If true, this is a probe-only JWT (HEAD requests only)
}
```

### Token Lifecycle

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│  1. Issuance │────▶│ 2. Attachment │────▶│ 3. Verify    │
│  POST        │     │  hls.js sets  │     │  HLS server   │
│  /api/tokens/│     │  Authorization│     │  checks sig + │
│  validate    │     │  Bearer <JWT> │     │  expiry + path│
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
┌─────────────┐     ┌──────────────┐     ┌───────▼──────┐
│ 6. Revoke   │     │ 5. Refresh   │◄────│ 4. Heartbeat │
│  Admin or   │     │  POST /api/  │     │  POST /api/  │
│  event      │     │  playback/   │     │  playback/   │
│  deactivate │     │  refresh     │     │  heartbeat   │
└──────┬──────┘     │  (every 50m) │     │  (every 30s) │
       │            └──────────────┘     └──────────────┘
       ▼
┌──────────────┐     ┌──────────────┐
│ 7. Sync      │────▶│ 8. Release   │
│  HLS polls   │     │  Player close │
│  /api/       │     │  sendBeacon() │
│  revocations │     │  to /release  │
└──────────────┘     └──────────────┘
```

1. **Issuance** — Viewer submits access code → Platform validates → creates `ActiveSession` → mints JWT with `jose` library
2. **Attachment** — hls.js `xhrSetup` injects `Authorization: Bearer <JWT>` on every HLS request
3. **Verification** — HLS server validates: signature → expiry → path prefix match → revocation cache (~0.01ms)
4. **Heartbeat** — Player sends `POST /api/playback/heartbeat` every 30s to keep session alive
5. **Refresh** — Player sends `POST /api/playback/refresh` every 50 minutes (before 60-min expiry)
6. **Revocation** — Admin revokes token or deactivates event → recorded in Platform DB
7. **Sync** — HLS server polls `GET /api/revocations?since=` every 30s → updates in-memory cache
8. **Release** — On player close, `navigator.sendBeacon()` sends `POST /api/playback/release`

### Why HMAC-SHA256, Not RSA?

| Factor | HMAC-SHA256 | RSA |
|--------|-------------|-----|
| Verification speed | ~0.01ms | ~0.5ms |
| Key management | Single shared secret | Public/private key pair |
| Service trust model | Both services are trusted (same operator) | Needed when verifier is untrusted |
| Token size | ~200 bytes | ~800 bytes (larger signatures) |
| Complexity | Minimal | Requires key rotation infrastructure |

StreamGate uses HMAC because both services share a trust boundary (same operator controls both). The simpler key management and 50× faster verification make HMAC the clear choice.

## Revocation Cache Design

The HLS server maintains an **in-memory `Map<string, number>`** mapping revoked token codes to their revocation timestamps.

### How It Works

```
Platform App DB                     HLS Server Memory
┌──────────────────┐                ┌──────────────────┐
│ Token table       │   poll every  │  RevocationCache  │
│ isRevoked: true   │──── 30s ────▶ │  Map<code, ts>    │
│ revokedAt: Date   │               │                   │
│                   │               │  "Ab3kF9": 17189  │
│ Event table       │               │  "Xp2mNq": 17190  │
│ isActive: false   │               │                   │
└──────────────────┘                └──────────────────┘
```

- **Polling mechanism**: `RevocationSyncService` calls `GET /api/revocations?since=<lastSync>` with `X-Internal-Api-Key` header
- **Incremental sync**: Only fetches changes since last successful sync
- **Failure tolerance**: Logs errors, continues serving with stale cache. Alerts after 5 minutes of consecutive failures
- **Cache eviction**: `evictOlderThan(maxAgeMs)` removes entries for tokens that have long since expired (no longer need tracking)

### Revocation Latency

| Event | Max Delay |
|-------|-----------|
| Admin revokes token | ≤30 seconds (next poll cycle) |
| Admin deactivates event | ≤30 seconds (next poll cycle) |
| Token expires naturally | 0 seconds (JWT `exp` check) |

:::warning
Revocation is **eventually consistent** with a maximum 30-second window. This is an intentional tradeoff: the alternative (database check on every HLS request) would add 5–50ms latency per segment and require the HLS server to have database access.
:::

## Why JWT Instead of Database Queries?

The HLS server validates authorization on **every** `.m3u8` manifest and `.ts` segment request. A typical viewer fetches 1 manifest + 3–5 segments every 6 seconds.

| Approach | Latency per check | DB connections needed | Scales to |
|----------|-------------------|-----------------------|-----------|
| Database query | 5–50ms | Pool per HLS instance | Limited by DB |
| JWT verification (HMAC) | ~0.01ms | **Zero** | CPU-bound (~50K/s/core) |

### The Tradeoff

JWT verification is **5,000×** faster and requires no database connection. The cost is a maximum 30-second revocation delay, which is acceptable for a video streaming use case where:

- Revocation is an admin action (rare)
- Viewers watching with a revoked token for 30 extra seconds causes no lasting harm
- The token will expire naturally within 1 hour regardless

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Platform App | Next.js 14+ (TypeScript) | Viewer portal, admin console, API routes |
| HLS Media Server | Express.js (TypeScript) | JWT-protected stream serving |
| Shared Library | TypeScript (no build step) | Types, constants, utilities |
| Database | Prisma ORM + SQLite (dev) / PostgreSQL (prod) | Event, token, session storage |
| Video Player | hls.js | HLS playback with JWT injection |
| UI Framework | React 18+ | Component-based UI |
| Styling | Tailwind CSS + shadcn/ui | Design system |
| Icons | Lucide | Icon library |
| Animation | Framer Motion | UI transitions |
| JWT Library | `jose` | JWT sign/verify (both services) |
| Admin Auth | bcrypt + iron-session | Password hashing + encrypted cookies |
| Token Generation | `crypto.randomBytes` | 12-char base62 codes (~71 bits entropy) |
