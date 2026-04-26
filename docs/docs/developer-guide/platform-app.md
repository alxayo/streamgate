---
sidebar_position: 2
title: Platform App
---

# Platform App

The Platform App is a **Next.js 14+** application serving three roles:

1. **Viewer Portal** — Public-facing token entry and HLS video player
2. **Admin Console** — Protected event and token management at `/admin`
3. **API Backend** — REST endpoints for token validation, JWT lifecycle, and admin CRUD

## Directory Structure

```
platform/
├── prisma/
│   └── schema.prisma          # Database schema (Event, Token, ActiveSession, SystemSettings)
├── src/
│   ├── app/                   # Next.js App Router
│   │   ├── page.tsx           # Viewer Portal entry page
│   │   ├── layout.tsx         # Root layout
│   │   ├── globals.css        # Tailwind CSS + global styles
│   │   ├── admin/             # Admin Console pages
│   │   │   ├── settings/      # System-wide stream settings page
│   │   │   └── events/[id]/   # Event detail with ingest + config cards
│   │   └── api/               # API Routes
│   │       ├── admin/         # Admin CRUD endpoints (session auth required)
│   │       │   ├── login/     # POST — admin login
│   │       │   ├── logout/    # POST — admin logout
│   │       │   ├── session/   # GET — check admin session
│   │       │   ├── events/    # GET/POST + /:id (GET/PUT/DELETE + actions)
│   │       │   ├── tokens/    # GET, PATCH /:id/revoke|unrevoke, bulk-revoke
│   │       │   ├── settings/  # GET/PUT — system-wide stream defaults
│   │       │   └── dashboard/ # GET — dashboard stats
│   │       ├── internal/      # Internal endpoints (X-Internal-Api-Key auth)
│   │       │   ├── stream-config/defaults/ # GET — system defaults for transcoder
│   │       │   └── events/[id]/stream-config/ # GET — per-event merged config
│   │       ├── tokens/        # POST /validate — public token validation
│   │       ├── playback/      # JWT refresh, heartbeat, release
│   │       ├── events/        # GET /:id/status — public event status
│   │       ├── rtmp/          # POST /auth — RTMP publish callback
│   │       └── revocations/   # GET ?since= — internal (HLS server polling)
│   ├── components/
│   │   ├── ui/                # shadcn/ui components
│   │   ├── player/            # Video player components
│   │   ├── admin/             # Admin components (event-form, settings-page)
│   │   └── viewer/            # Viewer flow components
│   ├── hooks/                 # Custom React hooks
│   ├── lib/                   # Utility modules (incl. stream-config merge/validation)
│   └── generated/prisma/      # Prisma client (auto-generated)
├── package.json
└── tsconfig.json
```

## App Router Pages and Routes

### Public Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | `page.tsx` | Viewer portal — token entry → player flow |
| `/admin` | `admin/page.tsx` | Admin console (redirects to login if unauthenticated) |

### Viewer Flow

The viewer experience is a single-page flow managed by React state:

```
TokenEntry → (validate) → PlayerScreen / PreEventScreen / AccessEnded / ErrorMessage
```

1. **TokenEntry** — Input field for 12-char access code
2. **PlayerScreen** — Full HLS player with all controls
3. **PreEventScreen** — Shown when event hasn't started yet (polls status every 30s)
4. **AccessEnded** — Shown when token or event has expired
5. **ErrorMessage** — Shown for validation errors (revoked, in-use, etc.)

## API Route Patterns

### Public Endpoints

These require no authentication — they are accessed by viewers:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/tokens/validate` | Submit access code → get JWT + event info |
| `POST` | `/api/playback/refresh` | Refresh JWT using current JWT as Bearer auth |
| `POST` | `/api/playback/heartbeat` | Keep session alive (every 30s) |
| `POST` | `/api/playback/release` | Release session on player close |
| `GET` | `/api/events/:id/status` | Get event status (not-started/live/ended/recording) |

### Admin Endpoints

All admin endpoints require an `iron-session` cookie set by `/api/admin/login`:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/admin/login` | Authenticate with password |
| `POST` | `/api/admin/logout` | Destroy admin session |
| `GET` | `/api/admin/session` | Check if admin is authenticated |
| `GET` | `/api/admin/events` | List all events |
| `POST` | `/api/admin/events` | Create event |
| `GET` | `/api/admin/events/:id` | Get event details |
| `PUT` | `/api/admin/events/:id` | Update event |
| `DELETE` | `/api/admin/events/:id` | Delete event (cascades tokens) |
| `PATCH` | `/api/admin/events/:id/activate` | Activate event |
| `PATCH` | `/api/admin/events/:id/deactivate` | Deactivate event |
| `PATCH` | `/api/admin/events/:id/archive` | Archive event |
| `PATCH` | `/api/admin/events/:id/unarchive` | Unarchive event |
| `GET` | `/api/admin/events/:id/tokens` | List tokens for event |
| `POST` | `/api/admin/events/:id/tokens` | Generate tokens for event |
| `GET` | `/api/admin/events/:id/tokens/export` | Export tokens as CSV |
| `GET` | `/api/admin/events/:id/stream-config` | Get effective stream config + ingest endpoints |
| `GET` | `/api/admin/tokens` | List all tokens (with filters) |
| `PATCH` | `/api/admin/tokens/:id/revoke` | Revoke a token |
| `PATCH` | `/api/admin/tokens/:id/unrevoke` | Unrevoke a token |
| `POST` | `/api/admin/tokens/bulk-revoke` | Bulk revoke tokens |
| `GET` | `/api/admin/dashboard` | Dashboard statistics |
| `GET` | `/api/admin/settings` | Get system-wide stream defaults |
| `PUT` | `/api/admin/settings` | Update system-wide stream defaults |

### Internal Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/revocations?since=` | `X-Internal-Api-Key` header | Returns revocations and event deactivations since timestamp |
| `GET` | `/api/internal/stream-config/defaults` | `X-Internal-Api-Key` header | Returns system-wide transcoder and player defaults |
| `GET` | `/api/internal/events/:id/stream-config` | `X-Internal-Api-Key` header | Returns merged per-event transcoder + player config |

### RTMP Callback

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/rtmp/auth` | `RTMP_AUTH_TOKEN` in body | Validates RTMP publish requests against event UUIDs |

### Response Format

All API routes follow a consistent JSON format:

```typescript
// Success
{ data: T }

// Error
{ error: "Human-readable error message" }
```

HTTP status codes are used semantically:

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad request (invalid input) |
| `401` | Unauthorized (invalid/missing token or session) |
| `403` | Forbidden (revoked token, deactivated event) |
| `404` | Not found |
| `409` | Conflict (token already in use on another device) |
| `410` | Gone (token or event expired) |
| `429` | Too many requests (rate limited) |

## Database Layer

### Prisma ORM

The database is managed via Prisma with the schema at `platform/prisma/schema.prisma`. In development, SQLite is used; production uses PostgreSQL.

```bash
# Initialize or migrate the database
npx prisma migrate dev

# Generate Prisma client after schema changes
npx prisma generate

# Open Prisma Studio (GUI database browser)
npx prisma studio
```

The Prisma client is instantiated as a singleton in `platform/src/lib/prisma.ts` to avoid exhausting connections during development hot-reloads.

### Migrations

Prisma migrations are stored in `platform/prisma/migrations/`. To create a new migration:

```bash
cd platform
npx prisma migrate dev --name describe-your-change
```

:::tip
Always run `npx prisma migrate dev` after pulling changes that modify `schema.prisma`. This ensures your local database schema matches the codebase.
:::

## Authentication Flow (Admin)

Admin authentication uses **bcrypt** password verification and **iron-session** encrypted cookies.

```
1. POST /api/admin/login  { password: "..." }
2. Server: bcrypt.compare(password, env.ADMIN_PASSWORD_HASH)
3. If match: iron-session sets encrypted HTTP-only cookie
4. Cookie: Secure, SameSite=Strict, 8-hour expiry
5. Subsequent requests: iron-session decrypts cookie → authenticated
```

:::note
There is a single admin password for the entire application, stored as a bcrypt hash in the `ADMIN_PASSWORD_HASH` environment variable. The `env.ts` module reads this hash directly from the `.env` file to avoid Next.js `$` character expansion issues with bcrypt hashes.
:::

## Token Validation Flow

When a viewer submits an access code:

```
POST /api/tokens/validate  { code: "Ab3kF9mNx2Qp" }

1. Rate limit check (5/min per IP)
2. Sanitize input (trim, alphanumeric-only check)
3. Database lookup: Token + associated Event (by code)
4. Validate:
   a. Token exists? → 401 "Invalid access code"
   b. Token expired? (expiresAt < now) → 410 "Access code has expired"
   c. Token revoked? → 403 "Access code has been revoked"
   d. Event active? → 403 "This event is not currently available"
5. Check for active session (single-device enforcement):
   a. Active session exists AND not timed out? → 409 "Access code is in use"
   b. Stale session? → Clean up and proceed
6. Create ActiveSession record (generates UUID session ID)
7. Mark token as redeemed (redeemedAt, redeemedIp) if first use
8. Mint JWT via jose library:
   - sub=code, eid=eventId, sid=sessionId, sp=/streams/:eventId/
   - 1-hour expiry (JWT_EXPIRY_SECONDS = 3600)
9. Return: { event: PublicEventInfo, playbackToken, playbackBaseUrl, streamPath, expiresAt, tokenExpiresIn }
```

:::info Dynamic playbackBaseUrl
The `playbackBaseUrl` returned to the browser is dynamically derived from the incoming request's `Host` header using `getHlsBaseUrl()` in `lib/env.ts`. This replaces the hostname in `HLS_SERVER_BASE_URL` with the request's hostname while preserving the HLS server port. This ensures LAN and remote clients receive a reachable HLS server URL without manual configuration.
:::

## JWT Refresh Flow

The player refreshes its JWT every 50 minutes (before the 60-minute expiry):

```
POST /api/playback/refresh
Authorization: Bearer <current-JWT>

1. Rate limit check (12/hour per token code)
2. Verify current JWT signature and extract claims
3. Look up token by claims.sub (access code)
4. Validate token is still valid (not revoked, not expired, event active)
5. Verify session still exists (claims.sid matches active session)
6. Mint new JWT with same claims but fresh iat/exp
7. Return: { playbackToken, tokenExpiresIn }
```

:::warning
The refresh endpoint extracts the access code from the JWT `sub` claim. The raw access code is **never stored** in browser memory after the initial validation — only the JWT is kept.
:::

## Session Management

### Heartbeat

The player sends heartbeats every 30 seconds to prove the viewer is still active:

```typescript
// use-session-heartbeat.ts hook
POST /api/playback/heartbeat
Authorization: Bearer <JWT>

→ Updates ActiveSession.lastHeartbeat to now()
→ Response: { ok: true }
```

### Session Timeout

If a session's `lastHeartbeat` is older than `SESSION_TIMEOUT_SECONDS` (default: 60s), the session is considered abandoned. This allows another device to use the same token.

### Session Release

On player close, the browser sends a `navigator.sendBeacon()` request:

```typescript
// use-session-release.ts hook
POST /api/playback/release
Authorization: Bearer <JWT>

→ Deletes ActiveSession record
→ Response: { released: true }
```

:::tip
`sendBeacon()` is used because it reliably fires during `beforeunload` / `visibilitychange` events, unlike `fetch()` which may be cancelled by the browser.
:::

## Rate Limiting

Three in-memory sliding-window rate limiters protect critical endpoints:

| Limiter | Limit | Window | Key | Endpoint |
|---------|-------|--------|-----|----------|
| Token validation | 5 requests | 1 minute | Client IP | `POST /api/tokens/validate` |
| JWT refresh | 12 requests | 1 hour | Token code | `POST /api/playback/refresh` |
| Admin login | 10 requests | 1 minute | Client IP | `POST /api/admin/login` |

The `RateLimiter` class uses an in-memory `Map` with a sliding window algorithm. It returns `{ allowed: boolean; retryAfterMs?: number }` and expired entries are periodically cleaned up.

## Stream Probing

The Platform App determines event status by probing the HLS server:

```typescript
// lib/stream-probe.ts
async function probeStreamLive(eventId: string): Promise<boolean> {
  // 1. Mint a short-lived probe JWT (10s expiry, probe: true)
  // 2. HEAD request to HLS server's manifest URL
  // 3. Check if response is 200 and manifest was recently modified (< 60s)
}
```

The probe JWT has `probe: true` in its claims, which restricts it to HEAD requests only on the HLS server side.

## React Component Organization

### UI Components (`components/ui/`)

9 shadcn/ui primitives: `Badge`, `Button`, `Card`, `Dialog`, `Input`, `Label`, `Select`, `Toast`, `Toaster`

### Player Components (`components/player/`)

| Component | Purpose |
|-----------|---------|
| `video-player` | Main HLS player container with hls.js integration |
| `fullscreen-toggle` | Fullscreen enter/exit button |
| `live-badge` | "LIVE" indicator badge |
| `loading-overlay` | Buffering/loading spinner overlay |
| `play-pause-button` | Play/pause toggle |
| `progress-bar` | Seek bar with buffer visualization |
| `quality-selector` | HLS quality level selector |
| `time-display` | Current time / duration display |
| `volume-control` | Volume slider with mute toggle |

### Admin Components (`components/admin/`)

| Component | Purpose |
|-----------|---------|
| `admin-sidebar` | Navigation sidebar |
| `event-form` | Create/edit event form |
| `event-list` | Event listing with actions |
| `event-status-badge` | Status indicator (active/archived/inactive) |
| `login-form` | Admin password login form |
| `token-status-badge` | Token status indicator (unused/redeemed/expired/revoked) |

### Viewer Components (`components/viewer/`)

| Component | Purpose |
|-----------|---------|
| `token-entry` | Access code input form |
| `player-screen` | Video player + controls wrapper |
| `pre-event-screen` | "Event hasn't started" waiting screen |
| `access-ended` | "Your access has ended" screen |
| `error-message` | Error display (revoked, in-use, etc.) |

## Custom Hooks

| Hook | Purpose |
|------|---------|
| `use-event-status` | Polls `GET /api/events/:id/status` every 30s for pre-event screens |
| `use-expiry-countdown` | Countdown timer for token expiry with 15-minute warning toast |
| `use-jwt-refresh` | Refreshes JWT every 50 minutes via `POST /api/playback/refresh` |
| `use-session-heartbeat` | Sends heartbeat every 30s via `POST /api/playback/heartbeat` |
| `use-session-release` | Registers `beforeunload`/`visibilitychange` to release session |
| `use-toast` | Toast notification system |
