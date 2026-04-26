---
sidebar_position: 7
title: Configuration Reference
---

# Configuration Reference

StreamGate is configured through environment variables. Both services read from `.env` files in their respective directories, with a root-level `.env` file providing shared defaults.

## File Locations

| File | Scope |
|------|-------|
| `.env` (project root) | Shared defaults for both services |
| `platform/.env` | Platform App overrides |
| `hls-server/.env` | HLS Media Server overrides |

Service-specific `.env` files take precedence over the root file.

---

## Shared Variables

These variables **must match** between the Platform App and HLS Media Server.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLAYBACK_SIGNING_SECRET` | ✅ | — | HMAC-SHA256 secret for signing and verifying JWT playback tokens. Must be at least 32 characters. Must be **identical** on both services. |
| `INTERNAL_API_KEY` | ✅ | — | API key used by the HLS server when polling the Platform App's `/api/revocations` endpoint. Sent as `X-Internal-Api-Key` header. Must be **identical** on both services. |

### Generating Shared Secrets

```bash
# PLAYBACK_SIGNING_SECRET — base64-encoded random bytes
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# INTERNAL_API_KEY — hex-encoded random bytes
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

:::danger Secret mismatch
If `PLAYBACK_SIGNING_SECRET` differs between services, JWT validation will fail on every HLS request — viewers will see a loading spinner but no video. If `INTERNAL_API_KEY` differs, revocation sync will fail — revoked tokens will continue to work until their JWT expires (up to 60 minutes).
:::

---

## Platform App Variables

Set these in `platform/.env` or the root `.env` file.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | `file:./dev.db` | Database connection string. SQLite for development (`file:./dev.db`), PostgreSQL for production (`postgresql://user:pass@host:5432/dbname`). |
| `ADMIN_PASSWORD_HASH` | ✅ | — | bcrypt hash of the admin console password. Generate with `npm run hash-password`. |
| `HLS_SERVER_BASE_URL` | ✅ | `http://localhost:4000` | Base URL of the HLS Media Server. In development, the actual URL sent to browsers is dynamically derived from the request's hostname (preserving the HLS server port), so LAN clients automatically get a reachable address. In production, set this to the public URL viewers will use. |
| `NEXT_PUBLIC_APP_NAME` | ❌ | `StreamGate` | Application name displayed in the UI. The `NEXT_PUBLIC_` prefix makes it available in the browser. |
| `SESSION_TIMEOUT_SECONDS` | ❌ | `60` | Seconds of missed heartbeats before a viewing session is considered abandoned and automatically released. Lower values free up tokens faster; higher values tolerate more network instability. See [Live Streaming Tuning Guide](./live-streaming-tuning.md#session-timeout-session_timeout_seconds) for trade-offs. |
| `RTMP_SERVER_HOST` | ❌ | — | RTMP server hostname/URL for ingest endpoint display in admin UI (e.g., `rtmp://rtmp.example.com:1935`). When set, the event detail page shows copy-ready RTMP ingest URLs. |
| `RTMP_AUTH_TOKEN` | ❌ | — | Shared secret for RTMP publish authentication. Appended to ingest URLs as `?token=` parameter. Also used to validate RTMP `on_publish` callbacks at `/api/rtmp/auth`. |
| `SRT_SERVER_HOST` | ❌ | — | SRT server hostname for ingest endpoint display (e.g., `srt://srt.example.com:9000`). When set, the event detail page includes an SRT ingest URL. |

### Database URL Examples

```env
# SQLite (development)
DATABASE_URL=file:./dev.db

# PostgreSQL (production)
DATABASE_URL=postgresql://streamgate:password@localhost:5432/streamgate

# PostgreSQL with SSL (cloud)
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

### Admin Password

Generate the bcrypt hash interactively:

```bash
npm run hash-password
# Enter your desired password when prompted
# Copy the output hash to ADMIN_PASSWORD_HASH
```

:::tip Password strength
Use a strong password (12+ characters, mixed case, numbers, symbols) for production deployments. The bcrypt hash uses 12 salt rounds by default.
:::

---

## HLS Media Server Variables

Set these in `hls-server/.env` or the root `.env` file.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLATFORM_APP_URL` | ✅ | `http://localhost:3000` | Internal URL of the Platform App. Used for revocation polling (`GET /api/revocations`). In Docker, use the container name (e.g., `http://platform:3000`). |
| `STREAM_ROOT` | Conditional | `./streams` | Local filesystem path where HLS stream files are stored. Required for local or hybrid mode. |
| `UPSTREAM_ORIGIN` | Conditional | — | Base URL of an upstream HLS origin server. Required for proxy or hybrid mode. |
| `SEGMENT_CACHE_ROOT` | ❌ | `STREAM_ROOT/cache/` | Directory for caching segments fetched from the upstream origin. Only used in proxy/hybrid mode. |
| `SEGMENT_CACHE_MAX_SIZE_GB` | ❌ | `50` | Maximum cache size in GB. When exceeded, least-recently-used segments are evicted. See [Tuning Guide](./live-streaming-tuning.md#segment-cache-tuning-proxyhybrid-mode) for sizing guidance. |
| `SEGMENT_CACHE_MAX_AGE_HOURS` | ❌ | `72` | Maximum age of cached segments in hours. Segments older than this are automatically cleaned up. See [Tuning Guide](./live-streaming-tuning.md#segment-cache-tuning-proxyhybrid-mode) for sizing guidance. |
| `REVOCATION_POLL_INTERVAL_MS` | ❌ | `30000` | How often (in milliseconds) to poll the Platform App for revocation updates. Lower values = faster revocation at the cost of more API calls. See [Tuning Guide](./live-streaming-tuning.md#revocation-polling-revocation_poll_interval_ms) for trade-offs. |
| `CORS_ALLOWED_ORIGIN` | ✅ | `http://localhost:3000` | Origin(s) allowed to make cross-origin requests to the HLS server. Must match the Platform App's public URL. Supports **comma-separated** values for multiple origins (e.g., `http://localhost:3000,http://192.168.0.11:3000`). |
| `PORT` | ❌ | `4000` | Port the HLS server listens on. |

---

## Content Source Modes

The HLS server supports three modes for sourcing stream content, determined by which environment variables are set:

| Mode | `STREAM_ROOT` | `UPSTREAM_ORIGIN` | Behavior |
|------|:------------:|:-----------------:|----------|
| **Local** | ✅ Set | ❌ Empty | Serves files directly from the local filesystem |
| **Proxy** | ❌ Empty | ✅ Set | Fetches content from upstream origin, caches locally |
| **Hybrid** | ✅ Set | ✅ Set | Checks local filesystem first, falls back to upstream |

### Local Mode

Best for: Single-server setups, development, and direct FFmpeg ingest.

```env
STREAM_ROOT=./streams
UPSTREAM_ORIGIN=
```

The server maps requests like `GET /streams/:eventId/stream.m3u8` to the local file `STREAM_ROOT/:eventId/stream.m3u8`.

### Proxy Mode

Best for: Edge deployments where content lives on a central origin server or CDN.

```env
STREAM_ROOT=
UPSTREAM_ORIGIN=https://origin.example.com/hls
```

The server fetches content from `https://origin.example.com/hls/:eventId/stream.m3u8` and caches segments locally for rewind/VOD rewatch.

### Hybrid Mode

Best for: Environments where some events stream locally and others come from an upstream origin.

```env
STREAM_ROOT=./streams
UPSTREAM_ORIGIN=https://origin.example.com/hls
```

For each request:
1. Check `STREAM_ROOT/:eventId/` — if the file exists locally, serve it
2. If not found locally, fetch from `UPSTREAM_ORIGIN/:eventId/`
3. Cache fetched segments to `SEGMENT_CACHE_ROOT/:eventId/`

### Choosing a Mode

| Question | Recommended Mode |
|----------|-----------------|
| FFmpeg runs on the same machine as the HLS server? | **Local** |
| Content is on a separate origin / CDN? | **Proxy** |
| Mix of local and remote events? | **Hybrid** |
| Need to cache upstream content for rewind? | **Proxy** or **Hybrid** |
| Single-server development setup? | **Local** |

---

## Example Configurations

### Minimal Development

```env
PLAYBACK_SIGNING_SECRET=my-dev-secret-at-least-32-characters-long
INTERNAL_API_KEY=dev-internal-api-key
ADMIN_PASSWORD_HASH=$2b$12$LJ3m4ys3Lk0TSwMBQWJJF.FzHqKn5A2n3MpGkbP0U7Q67rJFEyxGq
DATABASE_URL=file:./dev.db
HLS_SERVER_BASE_URL=http://localhost:4000
PLATFORM_APP_URL=http://localhost:3000
STREAM_ROOT=./streams
CORS_ALLOWED_ORIGIN=http://localhost:3000
```

### LAN Development (access from other devices)

```env
# Same as minimal, but allow LAN access:
CORS_ALLOWED_ORIGIN=http://localhost:3000,http://192.168.0.11:3000
# HLS_SERVER_BASE_URL remains localhost — the Platform App dynamically
# rewrites it based on the viewer's request origin.
```

:::tip LAN access in dev mode
The `next.config.mjs` auto-detects LAN IPv4 addresses and adds them to `allowedDevOrigins`, so Next.js dev mode works from LAN IPs without additional configuration. You only need to update `CORS_ALLOWED_ORIGIN` to include your LAN origin so the HLS server accepts cross-origin requests.
:::

### Production (PostgreSQL + Proxy Mode)

```env
PLAYBACK_SIGNING_SECRET=<strong-random-base64-key>
INTERNAL_API_KEY=<strong-random-hex-key>
ADMIN_PASSWORD_HASH=<bcrypt-hash>
DATABASE_URL=postgresql://streamgate:password@db.example.com:5432/streamgate
HLS_SERVER_BASE_URL=https://hls.example.com
NEXT_PUBLIC_APP_NAME=MyStreamingPlatform
SESSION_TIMEOUT_SECONDS=90
PLATFORM_APP_URL=https://app.example.com
UPSTREAM_ORIGIN=https://origin-cdn.example.com/hls
SEGMENT_CACHE_ROOT=/var/cache/streamgate
SEGMENT_CACHE_MAX_SIZE_GB=100
SEGMENT_CACHE_MAX_AGE_HOURS=168
REVOCATION_POLL_INTERVAL_MS=15000
CORS_ALLOWED_ORIGIN=https://app.example.com
PORT=4000
```

### Docker Compose (defaults in `docker-compose.yml`)

The Docker Compose file includes pre-configured values for local development. Override them by setting values in the root `.env` file or by adding a `docker-compose.override.yml`.

---

## Configuration Tips

:::tip Revocation speed vs. API load
`REVOCATION_POLL_INTERVAL_MS` controls the trade-off between revocation speed and API load. At 30,000ms (default), a revoked token could work for up to 30 seconds. Set to 5,000ms for faster revocation (at the cost of 6x more polling requests).
:::

:::warning CORS in production
`CORS_ALLOWED_ORIGIN` must exactly match the URL(s) your viewers use to access the Platform App — including protocol, domain, and port. Mismatched CORS settings will cause the player to fail with network errors. For LAN/multi-origin setups, use comma-separated values.
:::

:::info Public prefix
Only variables prefixed with `NEXT_PUBLIC_` are exposed to the browser. All other Platform App variables remain server-side only.
:::
