# Project Guidelines — Ticket-Gated Video Streaming Platform

## Architecture

Three independently deployable services in one monorepo:

| Service | Framework | Directory | Port |
|---------|-----------|-----------|------|
| **Platform App** | Next.js 14+ (TypeScript) | `platform/` | 3000 |
| **HLS Media Server** | Express.js (TypeScript) | `hls-server/` | 4000 |

They share **one HMAC secret** (`PLAYBACK_SIGNING_SECRET`) for JWT playback tokens and communicate only through:
- Browser attaches JWT as `Authorization: Bearer` header on every HLS request
- HLS server polls `GET /api/revocations?since=` from Platform App every 30s (returns both token revocations and event deactivations)

See [PDR.md](../PDR.md) for full specification, data model, API contracts, and deployment topologies.

### Platform App (`platform/`)
- **Viewer Portal** — Public token entry + HTML5/HLS player (hls.js)
- **Admin Console** — Protected event/token CRUD at `/admin`
- **API Routes** — Token validation, JWT issuance/refresh, session heartbeat/release, admin CRUD, revocation sync
- Database: Prisma ORM with SQLite (dev) / PostgreSQL (prod)

### HLS Media Server (`hls-server/`)
- Validates JWT on **every** `.m3u8` / `.ts` request (HMAC-SHA256, no DB)
- In-memory revocation cache (`Map<string, number>`)
- Three content modes: local file serving, upstream proxy, or hybrid (local first, upstream fallback)
- Convention-based paths: always serves at `/streams/:eventId/` regardless of content source
- Local mode: maps to `STREAM_ROOT/:eventId/` on disk
- Proxy mode: fetches from upstream origin using event's `streamUrl` field\n- Proxy mode persistently caches fetched segments to `SEGMENT_CACHE_ROOT/:eventId/` for rewind/VOD rewatch

## Tech Stack

- **Language**: TypeScript (strict mode) everywhere
- **Frontend**: React 18+, Tailwind CSS, shadcn/ui, Lucide icons, Framer Motion
- **Video**: hls.js with `xhrSetup` for Authorization header injection
- **JWT**: `jose` library (both services)
- **Database**: Prisma ORM — migrations in `platform/prisma/`
- **Auth**: bcrypt-hashed admin password via env var, encrypted cookie session (`iron-session`)
- **Token codes**: 12-char base62 via `crypto.randomBytes`
- **Token expiry**: Computed as `event.endsAt + event.accessWindowHours`

## Build and Test

```bash
# Platform App
cd platform
npm install
npx prisma migrate dev          # Initialize/migrate database
npm run dev                     # Next.js dev server on :3000

# HLS Media Server
cd hls-server
npm install
npm run dev                     # Express dev server on :4000

# Tests (both)
npm test                        # Jest
npm run lint                    # ESLint + Prettier
```

## Conventions

### API Routes (Platform App)
- All API routes under `platform/src/app/api/`
- Public endpoints: `/api/tokens/validate`, `/api/playback/refresh`, `/api/playback/heartbeat`, `/api/playback/release`, `/api/events/:id/status`
- Admin endpoints: `/api/admin/*` — require session cookie auth
- Internal endpoint: `/api/revocations` — require `X-Internal-Api-Key` header
- RTMP callback: `/api/rtmp/auth` — POST, validates `RTMP_AUTH_TOKEN` from body + event UUID for publish actions
- Return JSON with consistent shape: `{ data }` on success, `{ error: string }` on failure
- Use proper HTTP status codes: 401 (invalid token), 403 (revoked), 409 (token in use), 410 (expired), 429 (rate limited)

### JWT Playback Tokens
- Claims: `sub` (access code), `eid` (event ID), `sid` (session ID), `sp` (stream path prefix), `iat`, `exp`
- 1-hour expiry; player refreshes every 50 minutes by sending current JWT as Bearer auth
- Player sends heartbeat every 30 seconds to keep active session alive
- Session released on player close via `navigator.sendBeacon()` to `/api/playback/release`
- Refresh extracts code from JWT `sub` claim — never store raw access code in browser memory after initial validation
- HLS server validates: signature → expiry → path prefix match → revocation cache
- Safari fallback: accept JWT from `__token` query parameter (strip from logs)

### Component Patterns
- shadcn/ui components in `platform/src/components/ui/`
- Custom player components in `platform/src/components/player/`
- Admin components in `platform/src/components/admin/`
- Use Framer Motion for animations (200–300ms ease-out for controls, 100ms for hover)

### Security — Non-Negotiable
- Never expose raw `.m3u8` URLs to the client without JWT protection
- One token = one active viewer at a time (single-device enforcement via active session tracking)
- Rate-limit token validation: 5/min per IP
- Rate-limit JWT refresh: 12/hour per token code
- Admin password stored as bcrypt hash in `ADMIN_PASSWORD_HASH` env var
- All token codes alphanumeric only — reject non-alphanumeric input server-side
- HLS server error responses must be vague (no internal state leakage)
- Error messages for token validation: vague for unknown codes, specific for expired/revoked/deactivated
- Revocation sync includes event deactivations (not just individual token revocations)

### Database
- Prisma schema in `platform/prisma/schema.prisma`
- Token `code` field: unique index, 12-char base62
- Token `expiresAt`: computed from `event.endsAt + event.accessWindowHours`
- Always use Prisma transactions for batch token generation

### Environment Variables

Platform App:
- `ADMIN_PASSWORD_HASH`, `PLAYBACK_SIGNING_SECRET`, `INTERNAL_API_KEY`
- `DATABASE_URL`, `HLS_SERVER_BASE_URL`, `NEXT_PUBLIC_APP_NAME`
- `SESSION_TIMEOUT_SECONDS` (default: 60, how long before an inactive session is considered abandoned)
- `RTMP_AUTH_TOKEN` (shared secret for RTMP callback auth — validates ingest publish requests)

HLS Media Server:
- `PLAYBACK_SIGNING_SECRET` (must match Platform App)
- `PLATFORM_APP_URL`, `INTERNAL_API_KEY`, `CORS_ALLOWED_ORIGIN`
- `STREAM_ROOT` (local mode) or `UPSTREAM_ORIGIN` (proxy mode) or both (hybrid: local first, upstream fallback)
- `SEGMENT_CACHE_ROOT` (persistent cache for proxied segments; defaults to `STREAM_ROOT/cache/`)
- `SEGMENT_CACHE_MAX_SIZE_GB` (default: 50, LRU eviction when exceeded)
- `SEGMENT_CACHE_MAX_AGE_HOURS` (default: 72, age-based cleanup)
- `REVOCATION_POLL_INTERVAL_MS` (default: 30000)
