# Deployment Guide

## Prerequisites

- Node.js 20+
- npm 10+
- Docker (optional, for containerized deployment)

## Local Development Setup

### 1. Clone and Install

```bash
git clone <repository-url>
cd VideoPlayer
npm install
```

### 2. Generate Admin Password Hash

This creates the initial super admin account on first boot. Additional users are managed via the Admin Console after setup.

```bash
npm run hash-password
# Enter your desired admin password when prompted
# Copy the output ADMIN_PASSWORD_HASH=... into your .env files
```

You also need an `ADMIN_SESSION_SECRET` for session cookie encryption and TOTP secret storage:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Copy the output into ADMIN_SESSION_SECRET in your .env files
```

### 3. Configure Environment

Copy the example env files and fill in your values:

```bash
# Platform App
cp platform/.env.example platform/.env
# Edit platform/.env with your ADMIN_PASSWORD_HASH and a PLAYBACK_SIGNING_SECRET

# HLS Server
cp hls-server/.env.example hls-server/.env
# Edit hls-server/.env with the SAME PLAYBACK_SIGNING_SECRET
```

**Important**: `PLAYBACK_SIGNING_SECRET` and `INTERNAL_API_KEY` must be identical in both services.

### 4. Initialize Database

```bash
cd platform
npx prisma migrate dev
npx prisma db seed    # Optional: populate with sample data
```

### 5. Prepare Test Streams

Place HLS content in the streams directory:

```
streams/
└── <event-id>/
    ├── master.m3u8          # ABR master playlist (or single-variant)
    ├── stream_0/index.m3u8  # Variant playlist
    └── stream_0/seg_000.ts
```

> **Note**: The platform references `master.m3u8` as the entry-point manifest. If using FFmpeg's HLS muxer with ABR, use `-master_pl_name master.m3u8` for local file mode. In HTTP ingest mode (Azure deployment), the hls-transcoder uploads `master.m3u8` explicitly via HTTP PUT — FFmpeg's `-master_pl_name` only writes to the local filesystem even in HTTP output mode.

### 6. Start Development Servers

```bash
# Terminal 1: Platform App
cd platform
npm run dev    # Runs on port 3000

# Terminal 2: HLS Server
cd hls-server
npm run dev    # Runs on port 4000
```

### 7. Access the Application

- **Viewer Portal**: http://localhost:3000
- **Admin Console**: http://localhost:3000/admin
- **HLS Health Check**: http://localhost:4000/health

## Docker Deployment

### Using Docker Compose (Development)

```bash
docker-compose up --build
```

This starts both services co-located (Topology Option A from PDR §18.3).

### Production Deployment

For production, deploy services separately:

**Platform App** (Vercel, Docker, or any Node.js host):
```bash
docker build -f platform/Dockerfile -t streaming-platform .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e PLAYBACK_SIGNING_SECRET="your-secret" \
  -e INTERNAL_API_KEY="your-api-key" \
  -e ADMIN_PASSWORD_HASH="your-hash" \
  -e ADMIN_SESSION_SECRET="your-session-secret" \
  -e HLS_SERVER_BASE_URL="https://stream.example.com" \
  streaming-platform
```

**HLS Media Server** (VPS, Docker, or container runtime):
```bash
docker build -f hls-server/Dockerfile -t streaming-hls .
docker run -p 4000:4000 \
  -v /path/to/streams:/streams \
  -e PLAYBACK_SIGNING_SECRET="your-secret" \
  -e INTERNAL_API_KEY="your-api-key" \
  -e PLATFORM_APP_URL="https://app.example.com" \
  -e STREAM_ROOT="/streams" \
  -e CORS_ALLOWED_ORIGIN="https://app.example.com" \
  streaming-hls
```

> **Important**: `CORS_ALLOWED_ORIGIN` and `PLATFORM_APP_URL` must match the **public URL** that viewers use to access the platform — not an internal FQDN. If you use a custom domain (e.g., `watch.example.com`), set `CORS_ALLOWED_ORIGIN=https://watch.example.com` and `PLATFORM_APP_URL=https://watch.example.com`. Similarly, `HLS_SERVER_BASE_URL` in the platform must point to the HLS server's **public URL** (e.g., `https://hls.example.com`).

## Database Migration (SQLite → PostgreSQL)

1. Update `platform/prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
   }
   ```

2. Update `DATABASE_URL` in `.env`:
   ```
   DATABASE_URL="postgresql://user:password@host:5432/dbname"
   ```

3. Run migration:
   ```bash
   cd platform
   npx prisma migrate dev --name switch-to-postgres
   ```

## Environment Variable Reference

See `.env.example` files in each service directory and the root `.env.example` for a complete reference.

### Critical Shared Variables

| Variable | Description |
|----------|-------------|
| `PLAYBACK_SIGNING_SECRET` | HMAC-SHA256 secret for JWT signing/verification (min 32 chars). **Must match** between Platform App and HLS Server. |
| `INTERNAL_API_KEY` | API key for server-to-server communication. **Must match** between services. |

### Platform App Variables

| Variable | Description |
|----------|-------------|
| `ADMIN_PASSWORD_HASH` | Bcrypt hash of the initial super admin password (used for first-boot seeding only). |
| `ADMIN_SESSION_SECRET` | Secret for iron-session cookie encryption and AES-256-GCM TOTP secret encryption (min 32 chars). |
| `DATABASE_URL` | Database connection string (`file:./dev.db` for SQLite, `postgresql://...` for production). |
| `SESSION_TIMEOUT_SECONDS` | Seconds before an inactive viewing session is abandoned (default: 60). |

### Generating Secrets

```bash
# Generate a random signing secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate a random API key
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```
