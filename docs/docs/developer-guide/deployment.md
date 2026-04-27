---
sidebar_position: 8
title: Deployment
---

# Deployment

This guide covers deploying StreamGate from local development through production, including Docker Compose, deployment topologies, database migration, and scaling considerations.

## Local Development Setup

```bash
# 1. Install dependencies (npm workspaces)
npm install

# 2. Set up Platform App
cd platform
cp .env.example .env    # Configure environment variables
npx prisma migrate dev  # Initialize SQLite database
npm run dev              # Next.js dev server on :3000

# 3. Set up HLS Server (new terminal)
cd hls-server
npm run dev              # Express dev server on :4000
```

Minimum `.env` for local development:

```bash title="platform/.env"
DATABASE_URL="file:./dev.db"
PLAYBACK_SIGNING_SECRET="dev-secret-change-me-in-production-32chars"
INTERNAL_API_KEY="dev-internal-api-key-change-me"
ADMIN_PASSWORD_HASH="$2b$12$LJ3m4ys3Lk0TSwMBQWJJF.FzHqKn5A2n3MpGkbP0U7Q67rJFEyxGq"
HLS_SERVER_BASE_URL="http://localhost:4000"
NEXT_PUBLIC_APP_NAME="StreamGate"
SESSION_TIMEOUT_SECONDS="60"
```

## Docker Compose

The included `docker-compose.yml` runs both services together:

```yaml title="docker-compose.yml"
services:
  platform:
    build:
      context: .
      dockerfile: platform/Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: "file:./dev.db"
      PLAYBACK_SIGNING_SECRET: "dev-secret-change-me-in-production-32chars"
      INTERNAL_API_KEY: "dev-internal-api-key-change-me"
      ADMIN_PASSWORD_HASH: "$2b$12$..."
      HLS_SERVER_BASE_URL: "http://localhost:4000"
      NEXT_PUBLIC_APP_NAME: "StreamGate"
      SESSION_TIMEOUT_SECONDS: "60"
    volumes:
      - platform-data:/app/platform/prisma

  hls-server:
    build:
      context: .
      dockerfile: hls-server/Dockerfile
    ports:
      - "4000:4000"
    environment:
      PLAYBACK_SIGNING_SECRET: "dev-secret-change-me-in-production-32chars"
      INTERNAL_API_KEY: "dev-internal-api-key-change-me"
      PLATFORM_APP_URL: "http://platform:3000"
      STREAM_ROOT: "/streams"
      CORS_ALLOWED_ORIGIN: "http://localhost:3000"
      PORT: "4000"
    volumes:
      - ./streams:/streams

volumes:
  platform-data:
```

```bash
# Build and start
docker compose up --build

# Run in background
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

:::info
In Docker Compose, the HLS server uses `http://platform:3000` as the `PLATFORM_APP_URL` (Docker's internal DNS resolution), while `CORS_ALLOWED_ORIGIN` uses `http://localhost:3000` (the browser's perspective).
:::

## Deployment Topologies

### Topology A: Co-located (Single Server)

Best for: Development, demos, small-scale events (under 500 viewers).

```
┌──────────────────────────────────┐
│         Single Server            │
│                                  │
│  ┌───────────┐  ┌─────────────┐ │
│  │ Platform   │  │ HLS Server  │ │
│  │ App :3000  │  │      :4000  │ │
│  └─────┬─────┘  └──────┬──────┘ │
│        │               │        │
│  ┌─────▼───────────────▼──────┐ │
│  │     Reverse Proxy (nginx)  │ │
│  │     :443 (HTTPS)           │ │
│  └────────────────────────────┘ │
│                                  │
│  ┌────────────┐  ┌────────────┐ │
│  │  SQLite    │  │  /streams  │ │
│  │  Database  │  │  (files)   │ │
│  └────────────┘  └────────────┘ │
└──────────────────────────────────┘
```

**Configuration:**
- `HLS_SERVER_BASE_URL=http://localhost:4000`
- `PLATFORM_APP_URL=http://localhost:3000`
- Use nginx to terminate TLS and proxy to both services

### Topology B: Separated (PaaS + VPS)

Best for: Production deployments, moderate scale (500–5,000 viewers).

```
┌─────────────────────┐          ┌────────────────────────┐
│  PaaS (Vercel, etc.) │          │  VPS / Cloud VM        │
│                      │          │                         │
│  ┌────────────────┐  │          │  ┌─────────────────┐   │
│  │  Platform App   │  │  poll   │  │  HLS Server      │   │
│  │  (Next.js)     │◄─┼─────────┼──│  (Express)       │   │
│  └────────┬───────┘  │  /api/  │  └────────┬────────┘   │
│           │          │  revoc. │           │             │
│  ┌────────▼───────┐  │          │  ┌────────▼────────┐   │
│  │  PostgreSQL    │  │          │  │  /streams       │   │
│  │  (managed)     │  │          │  │  (local files)  │   │
│  └────────────────┘  │          │  └─────────────────┘   │
└─────────────────────┘          └────────────────────────┘
```

**Configuration:**
- Platform: `HLS_SERVER_BASE_URL=https://hls.example.com`
- HLS: `PLATFORM_APP_URL=https://app.example.com`
- HLS: `CORS_ALLOWED_ORIGIN=https://app.example.com`
- PostgreSQL via managed database service

### Topology C: Edge / Multi-Region

Best for: Global audiences, large scale (5,000+ viewers across regions).

```
                    ┌─────────────────────┐
                    │  Central Platform    │
                    │  App (Primary)       │
                    │  + PostgreSQL        │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐ ┌──────▼────────┐ ┌─────▼────────┐
    │ HLS Server     │ │ HLS Server    │ │ HLS Server   │
    │ US-East        │ │ EU-West       │ │ AP-Southeast │
    │ + Local cache  │ │ + Local cache │ │ + Local cache│
    └────────────────┘ └───────────────┘ └──────────────┘
```

**Configuration:**
- Each HLS instance polls the central Platform App
- Use proxy mode with shared upstream origin, or replicate content
- DNS-based geographic routing (CloudFlare, Route 53)
- Each HLS instance maintains its own revocation cache

:::tip
The HLS server's stateless design (no database, JWT-only auth) makes it ideal for edge deployment. Spin up instances close to your viewers for minimal latency.
:::

## Database Migration: SQLite → PostgreSQL

### Step-by-step

1. **Update the Prisma datasource provider:**

```prisma title="platform/prisma/schema.prisma"
datasource db {
  provider = "postgresql"  // Change from "sqlite"
}
```

2. **Set the production database URL:**

```bash
DATABASE_URL="postgresql://user:password@host:5432/streamgate?sslmode=require"
```

3. **Generate new migrations:**

```bash
cd platform

# If starting fresh (no existing data to preserve):
npx prisma migrate dev --name init-postgres

# If migrating existing data, use Prisma's migration tools or
# export/import data manually
```

4. **Deploy migrations:**

```bash
npx prisma migrate deploy
```

:::warning
SQLite and PostgreSQL have subtle differences (e.g., case sensitivity, date handling). Test thoroughly after switching providers. The Prisma schema as-is is compatible with both providers.
:::

## Database Seeding

After running migrations, seed the database to generate initial shared secrets (`INTERNAL_API_KEY`, `PLAYBACK_SIGNING_SECRET`, `RTMP_AUTH_TOKEN`) in the `SystemConfig` table:

```bash
cd platform
npx prisma db seed
```

The seed script is idempotent — it skips keys that already exist. If environment variables are set for any key, those values are imported into the database; otherwise, cryptographically random values are generated.

:::tip
On first deploy, run `npx prisma migrate deploy && npx prisma db seed` to initialize both the schema and shared secrets in one step.
:::

## Production Deployment

### Image Tagging

Deploy scripts use timestamp-based image tags (`v$(date +%s)`) instead of `:latest` to ensure deterministic rollouts and easy rollback:

```bash
IMAGE_TAG="v$(date +%s)"
docker build -t myregistry/streamgate-platform:$IMAGE_TAG .
docker push myregistry/streamgate-platform:$IMAGE_TAG
```

### Post-Deploy Verification

Deploy scripts include a `verify_deployment()` function that polls container health after deployment:

1. Waits for the container to reach a running state
2. Hits the `/health` endpoint to confirm the service is responsive
3. Fails the deploy if the health check doesn't pass within the timeout

```bash
# Example: verify a container is healthy
curl -sf http://localhost:3000/api/health || echo "Platform unhealthy"
curl -sf http://localhost:4000/health || echo "HLS server unhealthy"
```

## Scaling Considerations

:::tip Cloud Deployment
For detailed Azure deployment architectures with scale-to-zero, CDN caching, and cost estimates for 10 to 10,000+ concurrent viewers, see the [Cloud Architecture (Azure)](./cloud-architecture/README.md) guide.
:::

### Platform App

- **Horizontal scaling**: Deploy multiple instances behind a load balancer
- **Database**: PostgreSQL connection pooling (e.g., PgBouncer) for many instances
- **Rate limiters**: In-memory rate limiters are per-instance; use Redis for shared state in multi-instance deployments
- **Sessions**: `iron-session` cookies are self-contained (encrypted in cookie) — no sticky sessions needed

### HLS Media Server

| Metric | Approximate Capacity |
|--------|---------------------|
| JWT verifications | ~50,000/sec/core |
| Concurrent viewers per instance | ~5,000 (depends on bitrate and network) |
| Revocation cache memory | ~100 bytes per entry |

- **CPU-bound**: JWT verification is the primary CPU cost
- **I/O-bound**: Segment serving is I/O bound (disk or network)
- **Stateless**: No shared state between instances (each has own revocation cache)
- **Scale-out**: Add more instances behind a load balancer

### Content Delivery

- **Local mode**: Disk I/O is the bottleneck; use SSDs
- **Proxy mode**: Network to upstream is the bottleneck; segment cache reduces repeated fetches
- **Hybrid mode**: Best of both — local for known content, upstream for dynamic content

## Environment Variable Reference

### Shared Variables

These must match between Platform App and HLS Server:

| Variable | Required | Description |
|----------|----------|-------------|
| `PLAYBACK_SIGNING_SECRET` | Yes* | HMAC-SHA256 secret for JWT signing/verification. Minimum 32 characters. **Must be identical on both services.** |
| `INTERNAL_API_KEY` | Yes* | API key for revocation sync and internal config endpoints. **Must be identical on both services.** |
| `RTMP_AUTH_TOKEN` | Yes* | Shared secret for RTMP callback authentication. |

\* These secrets can be stored in the `SystemConfig` database table instead of environment variables. Services resolve them using the config resolution pattern (env var → DB → error). The HLS server and RTMP server fetch missing secrets from the Platform App's `GET /api/internal/config` endpoint at startup.

### Platform App Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | Prisma database connection string |
| `ADMIN_PASSWORD_HASH` | Yes | — | bcrypt hash of admin password |
| `HLS_SERVER_BASE_URL` | Yes | — | Base URL of HLS server (e.g., `http://localhost:4000`) |
| `NEXT_PUBLIC_APP_NAME` | No | `"StreamGate"` | Application name shown in UI |
| `SESSION_TIMEOUT_SECONDS` | No | `60` | Seconds before inactive session is considered abandoned |
| `ADMIN_PASSWORD_HASH_FILE` | No | — | Alternative: read admin hash from a file (for Docker secrets) |

### HLS Server Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PLATFORM_APP_URL` | Yes | — | Base URL of Platform App for revocation polling |
| `CORS_ALLOWED_ORIGIN` | Yes | — | Allowed CORS origin (Platform App URL as seen by browser) |
| `PORT` | No | `4000` | HTTP port to listen on |
| `STREAM_ROOT` | Conditional | — | Root directory for local stream files. At least one of `STREAM_ROOT` or `UPSTREAM_ORIGIN` required. |
| `UPSTREAM_ORIGIN` | Conditional | — | Upstream origin URL for proxy mode. At least one of `STREAM_ROOT` or `UPSTREAM_ORIGIN` required. |
| `SEGMENT_CACHE_ROOT` | No | `STREAM_ROOT/cache/` | Root directory for cached upstream segments |
| `SEGMENT_CACHE_MAX_SIZE_GB` | No | `50` | Maximum segment cache size in GB (LRU eviction) |
| `SEGMENT_CACHE_MAX_AGE_HOURS` | No | `72` | Maximum age of cached segments in hours |
| `REVOCATION_POLL_INTERVAL_MS` | No | `30000` | Revocation polling interval in milliseconds |

## Generating Secrets

Shared secrets can be managed in two ways:
1. **Database (recommended)** — Run `npx prisma db seed` to auto-generate, or use the Admin Config page (`/admin/config`) to view, edit, and regenerate secrets
2. **Environment variables** — Set manually per service (env vars always take precedence over DB values)

### Signing Secret (PLAYBACK_SIGNING_SECRET)

```bash
# Method 1: OpenSSL
openssl rand -base64 32

# Method 2: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Method 3: Python
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Internal API Key (INTERNAL_API_KEY)

```bash
# Use same generation methods as above
openssl rand -hex 32
```

### Admin Password Hash (ADMIN_PASSWORD_HASH)

```bash
# Node.js with bcrypt
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('your-secure-password', 12).then(console.log)"

# Or use htpasswd
# Note: bcrypt hashes contain $ characters — use ADMIN_PASSWORD_HASH_FILE
# or read directly from .env to avoid shell expansion issues
```

:::danger
- Never reuse secrets across environments (dev/staging/prod)
- Never commit secrets to version control
- Use Docker secrets or a secrets manager in production
- The default `docker-compose.yml` values are **for development only**
:::
