---
sidebar_position: 3
title: Docker Setup
---

# Docker Setup

Get StreamGate running in containers with a single command. Docker Compose sets up both services pre-configured and ready to use.

## Prerequisites

| Software | Version | Check |
|----------|---------|-------|
| **Docker** | 20+ | `docker --version` |
| **Docker Compose** | v2+ | `docker compose version` |

:::tip Install Docker Desktop
The easiest way to get both Docker and Docker Compose is [Docker Desktop](https://www.docker.com/products/docker-desktop/) — available for Windows, macOS, and Linux.
:::

## Quick Start

```bash
# Clone the repository
git clone https://github.com/your-username/VideoPlayer.git
cd VideoPlayer

# Start both services
docker-compose up --build
```

That's it. Both services start with development defaults:

| Service | URL | Default Credentials |
|---------|-----|-------------------|
| **Platform App** | http://localhost:3000 | Admin password: `admin123` |
| **HLS Media Server** | http://localhost:4000 | — |

:::info First run
The first `docker-compose up --build` takes a few minutes to build the images. Subsequent starts are much faster.
:::

## What Docker Compose Sets Up

The `docker-compose.yml` configures both services with sensible defaults:

### Platform App Container
- Next.js app on port **3000**
- SQLite database (persisted via Docker volume)
- Pre-configured development secrets
- Connected to the HLS server container

### HLS Media Server Container
- Express server on port **4000**
- Stream directory mounted from `./streams/` on your host
- CORS configured for `http://localhost:3000`
- Revocation polling connected to the Platform App container

## Stream Directory

When using Docker, the `./streams/` directory at the project root is mounted into the HLS server container:

```
Host:      ./streams/         →  Container: /streams
```

Place your HLS stream files here, organized by event ID:

```bash
# Create a stream directory for your event
mkdir -p streams/YOUR_EVENT_ID

# FFmpeg writes directly to the host directory
ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=44100 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "streams/YOUR_EVENT_ID/segment-%03d.ts" \
  "streams/YOUR_EVENT_ID/stream.m3u8"
```

:::warning Path difference
Note that when running with Docker, stream files go in `./streams/` (project root), not `./hls-server/streams/` (which is used in manual setup).
:::

## Custom Configuration

### Override Environment Variables

Create a `.env` file at the project root to override defaults:

```env
# Use your own secrets (recommended for anything beyond local dev)
PLAYBACK_SIGNING_SECRET=my-secure-secret-at-least-32-chars
INTERNAL_API_KEY=my-internal-api-key
ADMIN_PASSWORD_HASH=$2b$12$your-bcrypt-hash-here
```

Generate a password hash on your host machine:

```bash
# Requires Node.js on the host
npm run hash-password
```

Then restart the containers:

```bash
docker-compose down
docker-compose up --build
```

### Override with `docker-compose.override.yml`

For more complex customizations, create a `docker-compose.override.yml`:

```yaml
services:
  platform:
    environment:
      NEXT_PUBLIC_APP_NAME: "My Custom Brand"
      SESSION_TIMEOUT_SECONDS: "120"

  hls-server:
    environment:
      REVOCATION_POLL_INTERVAL_MS: "15000"
```

Docker Compose automatically merges override files with the base configuration.

## Persistent Volumes

The Docker setup uses a named volume for the Platform App's database:

| Volume | Purpose | Location |
|--------|---------|----------|
| `platform-data` | SQLite database persistence | `/app/platform/prisma` in container |
| `./streams` (bind mount) | Stream files | `/streams` in HLS server container |

### Reset the database

To start fresh:

```bash
docker-compose down -v   # -v removes named volumes
docker-compose up --build
```

## Common Docker Commands

```bash
# Start in the background (detached)
docker-compose up -d --build

# View logs
docker-compose logs -f

# View logs for a specific service
docker-compose logs -f platform
docker-compose logs -f hls-server

# Stop services
docker-compose down

# Rebuild after code changes
docker-compose up --build

# Shell into a running container
docker-compose exec platform sh
docker-compose exec hls-server sh
```

## Production Considerations

The default `docker-compose.yml` is configured for **development**. For production:

:::danger Do not use development secrets in production
The default `docker-compose.yml` includes placeholder secrets. Always override them with strong, unique values for any non-local deployment.
:::

1. **Replace all secrets** — Generate unique `PLAYBACK_SIGNING_SECRET`, `INTERNAL_API_KEY`, and `ADMIN_PASSWORD_HASH` values
2. **Use PostgreSQL** — Replace SQLite with a PostgreSQL database by changing `DATABASE_URL`
3. **Configure CORS** — Set `CORS_ALLOWED_ORIGIN` to your actual domain
4. **Use HTTPS** — Place a reverse proxy (nginx, Caddy, or cloud load balancer) in front of both services
5. **Separate containers** — Consider running the Platform App and HLS server on separate hosts for scalability

## Next Steps

- [Admin Console](../admin-console.md) — Create events and generate tokens
- [Live Streaming with FFmpeg](../streaming-with-ffmpeg.md) — Start sending video content
- [Configuration Reference](../configuration.md) — All environment variables explained
