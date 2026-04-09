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

---

## Integrating rtmp-go for RTMP Ingest (Step-by-Step)

This section explains how to use [rtmp-go](https://github.com/alxayo/rtmp-go) as your RTMP ingest endpoint, trigger FFmpeg to produce HLS segments, and connect the output to the platform's HLS server. Both local and Docker workflows are covered.

### 1. RTMP Ingest with rtmp-go

- **Start rtmp-go** (see [rtmp-go docs](https://github.com/alxayo/rtmp-go) for install/run instructions):
  ```bash
  rtmp-go -listen :1935
  ```
- Your streaming software (e.g., OBS) should push to `rtmp://localhost:1935/live/stream`.

### 2. FFmpeg: RTMP to HLS

- Start FFmpeg to listen for RTMP and output HLS segments:
  ```bash
  ffmpeg -i rtmp://localhost:1935/live/stream \
    -c:v libx264 -preset ultrafast -tune zerolatency \
    -c:a aac -b:a 128k \
    -f hls -hls_time 2 -hls_list_size 10 \
    -hls_flags delete_segments+append_list \
    -hls_segment_filename "streams/YOUR_EVENT_ID/segment-%03d.ts" \
    "streams/YOUR_EVENT_ID/stream.m3u8"
  ```
- Replace `YOUR_EVENT_ID` with the event UUID from the platform admin console.
- For Docker, use the `./streams/` directory at the project root (see above for path differences).

### 3. Platform Event & Token Creation

- In the Platform Admin Console (`http://localhost:3000/admin`):
  1. Create a new event. Note the generated event ID (UUID).
  2. Generate a playback token for your event (see [platform docs](../admin-console.md)).

### 4. Watch the Stream

- Open **http://localhost:3000** in your browser (Viewer Portal)
- Enter the **token code** generated in Step 3 (12-character alphanumeric string)
- The player will automatically connect to the HLS server with JWT authentication

Alternatively, use the automation scripts to skip manual admin console steps:
```bash
# All-in-one: creates event, tokens, and launches FFmpeg
npm run rtmp-ingest

# Or create the event first, then run FFmpeg separately
npm run create-event
```

### 5. Directory Structure Reference

- Local: `hls-server/streams/YOUR_EVENT_ID/`
- Docker: `./streams/YOUR_EVENT_ID/` (project root)

### 6. Troubleshooting & Common Pitfalls

- **No .ts files generated:**
  - Check that the stream directory exists and matches the event ID.
  - Ensure FFmpeg is running and receiving RTMP input (see FFmpeg logs).
- **Player shows nothing:**
  - Confirm the manifest is named `stream.m3u8` and segments are appearing.
  - Check the playback URL includes a valid JWT token.
- **Port conflicts:**
  - If port 1935 is in use, stop other RTMP servers or change the port in both rtmp-go and FFmpeg.
- **Docker path issues:**
  - Always use `./streams/` at the project root for Docker. Do not use `hls-server/streams/`.
- **Token errors:**
  - Ensure the JWT token is for the correct event and not expired/revoked.
- **Firewall/network:**
  - If ingesting from a remote machine, open port 1935 and use the correct IP address.

### 7. References

- [FFmpeg Streaming Guide](../streaming-with-ffmpeg.md)
- [HLS Server Reference](../../developer-guide/hls-server.md)
- [rtmp-go Documentation](https://github.com/alxayo/rtmp-go)
- [Platform Admin Console](../admin-console.md)

## Next Steps

- [Admin Console](../admin-console.md) — Create events and generate tokens
- [Live Streaming with FFmpeg](../streaming-with-ffmpeg.md) — Start sending video content
- [RTMP Ingest with rtmp-go](#integrating-rtmp-go-for-rtmp-ingest-step-by-step) — Set up live RTMP ingest with FFmpeg
- [Configuration Reference](../configuration.md) — All environment variables explained
