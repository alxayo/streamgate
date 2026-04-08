---
sidebar_position: 2
title: Manual Setup
---

# Manual Setup

This guide walks through a complete StreamGate installation from source, covering every configuration option.

## 1. Clone the Repository

```bash
git clone https://github.com/your-username/VideoPlayer.git
cd VideoPlayer
```

## 2. Install Dependencies

StreamGate uses npm workspaces — a single install at the root gets everything:

```bash
npm install
```

This installs dependencies for all three packages:
- `shared/` — Common types and utilities
- `platform/` — Next.js Platform App
- `hls-server/` — Express HLS Media Server

## 3. Configure Environment Variables

StreamGate uses `.env` files for configuration. Each service has its own file, plus there's a root-level file for shared variables.

### Copy example files

```bash
# Root-level (shared variables)
cp .env.example .env

# Platform App
cp platform/.env.example platform/.env

# HLS Media Server
cp hls-server/.env.example hls-server/.env
```

:::info
During development, the root `.env` file provides defaults. Service-specific `.env` files override the root values. You can configure either the root file or individual service files — just ensure shared secrets match.
:::

### Generate Secrets

You need three secrets. Generate each one and paste them into your `.env` files.

#### `PLAYBACK_SIGNING_SECRET` — JWT Signing Key

This HMAC-SHA256 key must be identical on both services. Use at least 32 characters.

```bash
# Method 1: Node.js one-liner
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Method 2: OpenSSL
openssl rand -base64 32

# Method 3: Use any strong random string (min 32 characters)
```

#### `INTERNAL_API_KEY` — Inter-Service Authentication

Used by the HLS server when polling the Platform App's revocation endpoint.

```bash
# Method 1: Node.js
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

# Method 2: OpenSSL
openssl rand -hex 24

# Method 3: Any random string
```

#### `ADMIN_PASSWORD_HASH` — Admin Console Password

Choose an admin password and generate its bcrypt hash:

```bash
# Interactive prompt — enter your desired password
npm run hash-password
```

This runs `npx tsx scripts/hash-password.ts` and outputs a bcrypt hash like `$2b$12$...`. Paste the full hash into your `.env`.

:::danger Keep your secrets safe
Never commit `.env` files to version control. The `.gitignore` is pre-configured to exclude them.
:::

### Configure Remaining Variables

Edit your `.env` files with the generated secrets and review the remaining settings:

**Root `.env`** (or `platform/.env` + `hls-server/.env`):

```env
# === Shared (must match between services) ===
PLAYBACK_SIGNING_SECRET=your-generated-base64-key-here
INTERNAL_API_KEY=your-generated-hex-key-here

# === Platform App ===
DATABASE_URL=file:./dev.db
ADMIN_PASSWORD_HASH=$2b$12$your-hash-here
HLS_SERVER_BASE_URL=http://localhost:4000
NEXT_PUBLIC_APP_NAME=StreamGate
SESSION_TIMEOUT_SECONDS=60

# === HLS Media Server ===
PLATFORM_APP_URL=http://localhost:3000
STREAM_ROOT=./streams
UPSTREAM_ORIGIN=
SEGMENT_CACHE_ROOT=
SEGMENT_CACHE_MAX_SIZE_GB=50
SEGMENT_CACHE_MAX_AGE_HOURS=72
REVOCATION_POLL_INTERVAL_MS=30000
CORS_ALLOWED_ORIGIN=http://localhost:3000
PORT=4000
```

:::tip Minimal config
For local development, you only need to set the three secrets. All other values have sensible defaults.
:::

See the [Configuration Reference](../configuration.md) for detailed descriptions of every variable.

## 4. Initialize the Database

StreamGate uses Prisma ORM with SQLite for development:

```bash
cd platform

# Run migrations to create the database schema
npx prisma migrate dev --name init

# (Optional) Seed with sample data
npx prisma db seed

cd ..
```

The SQLite database file is created at `platform/prisma/dev.db`.

:::info Production databases
For production, change `DATABASE_URL` to a PostgreSQL connection string:
```
DATABASE_URL=postgresql://user:password@host:5432/streamgate
```
Then run `npx prisma migrate deploy` instead of `migrate dev`.
:::

## 5. Prepare Stream Directory

Create the directory where HLS stream files will be stored:

```bash
mkdir -p hls-server/streams
```

On Windows:
```powershell
mkdir hls-server\streams
```

The HLS server serves files from this directory at `/streams/:eventId/`.

## 6. Start the Services

Open two terminal windows:

**Terminal 1 — Platform App:**

```bash
cd platform
npm run dev
```

Expected output:
```
  ▲ Next.js 14.x.x
  - Local:        http://localhost:3000
  ✓ Ready
```

**Terminal 2 — HLS Media Server:**

```bash
cd hls-server
npm run dev
```

Expected output:
```
HLS Media Server listening on port 4000
Revocation sync started (interval: 30000ms)
```

## 7. Verify the Installation

### Check Platform App

Open **http://localhost:3000** — you should see the token entry page (Viewer Portal).

Open **http://localhost:3000/admin** — you should see the admin login page.

### Check HLS Media Server

The HLS server responds to stream requests only with valid JWTs. A simple connectivity check:

```bash
# Should return 401 (no JWT provided) — this confirms the server is running
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/streams/test/stream.m3u8
# Expected: 401
```

### Verify inter-service communication

Check that the HLS server can reach the Platform App's revocation endpoint. Look at the HLS server terminal output — you should see successful revocation sync logs (no error messages about failed polling).

## 8. Create Your First Event

1. Go to **http://localhost:3000/admin**
2. Log in with your admin password
3. Create an event with a time range that includes the current time
4. Generate tokens for the event
5. Copy a token code

You're now ready to start streaming! See [Live Streaming with FFmpeg](../streaming-with-ffmpeg.md) for next steps.

---

## Directory Structure Reference

After setup, your project should look like this:

```
VideoPlayer/
├── .env                  # Shared environment variables
├── package.json          # Root package (npm workspaces)
├── docker-compose.yml    # Docker Compose config
├── shared/               # Shared types and utilities
├── platform/             # Platform App (Next.js)
│   ├── .env              # Platform-specific env vars
│   ├── prisma/
│   │   ├── schema.prisma # Database schema
│   │   └── dev.db        # SQLite database (created after migrate)
│   └── src/
├── hls-server/           # HLS Media Server (Express)
│   ├── .env              # HLS server-specific env vars
│   └── streams/          # Stream files directory
│       └── <event-id>/   # One directory per event
│           ├── stream.m3u8
│           └── segment-*.ts
└── docs/                 # Documentation (Docusaurus)
```
