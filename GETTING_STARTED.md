# Getting Started — Ticket-Gated Video Streaming Platform

A complete step-by-step guide to set up, run, and use the ticket-gated video streaming platform.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Prerequisites](#prerequisites)
4. [Step 1: Project Setup](#step-1-project-setup)
5. [Step 2: Environment Configuration](#step-2-environment-configuration)
6. [Step 3: Generate Admin Password Hash](#step-3-generate-admin-password-hash)
7. [Step 4: Database Initialization](#step-4-database-initialization)
8. [Step 5: Prepare Test Streams](#step-5-prepare-test-streams)
9. [Step 6: Start the Services](#step-6-start-the-services)
10. [Step 7: Using the System](#step-7-using-the-system)
11. [API Reference](#api-reference)
12. [Common Tasks](#common-tasks)
13. [Troubleshooting](#troubleshooting)

---

## System Overview

This is a **two-service video streaming platform** with JWT-based token authentication:

### What It Does
- **Viewers** enter a token code to access restricted video streams
- **Admins** manage events, generate access tokens, and monitor usage
- **HLS Media Server** validates tokens on every segment request using cryptographic signatures (no database queries needed)
- Tokens can be revoked in real-time with <30-second propagation

### Key Features
✅ JWT-based playback authentication (HMAC-SHA256)  
✅ In-memory revocation cache synced every 30 seconds  
✅ Single-device enforcement (one token = one active viewer at a time)  
✅ Session heartbeat & automatic release  
✅ Local file serving + optional upstream proxy support  
✅ Segment caching with LRU eviction  

---

## Architecture at a Glance

```
┌─────────────────────────────────────────┐
│         VIEWER PORTAL (Public)          │
│  1. Enter token code                    │
│  2. Receive playback JWT                │
│  3. Watch stream with auto-refresh      │
└──────────────┬──────────────────────────┘
               │ JWT in Authorization header
               │
        ┌──────▼─────────────────────────────────┐
        │  PLATFORM APP (Next.js Port 3000)      │
        ├──────────────────────────────────────┤
        │ • Token validation API                │
        │ • JWT issuance & refresh              │
        │ • Admin console (protected)           │
        │ • Event/token CRUD                    │
        │ • Revocation polling endpoint         │
        └──────────────┬──────────────────────┬──┘
                       │                      │
                       │                      │
                       │            Polls /api/revocations
                       │                  every 30 seconds
                       │      ┌────────────────────┐
                       │      │                    │
        ┌──────────────▼──────┴──────┐   ┌────────▼────────────────────────┐
        │  DATABASE (SQLite/Postgres) │   │  HLS MEDIA SERVER (Express 4000)│
        │  - Events                   │   │ • JWT signature verification    │
        │  - Tokens                   │   │ • Revocation cache check        │
        │  - Active sessions          │   │ • Serve .m3u8 & .ts files      │
        │  - Admin passwords          │   │ • Optional upstream proxy       │
        └─────────────────────────────┘   │ • Segment caching               │
                                          └─────────────────────────────────┘
```

**Key Communication Flow:**

1. Viewer enters token code → Platform validates → Issues JWT (1-hour expiry)
2. Browser attaches JWT to every HLS request (manifests & segments)
3. HLS server validates JWT signature (CPU-only, ~0.01ms, no DB query)
4. HLS server checks revocation cache (synced from Platform every 30s)
5. If valid → serve stream | If revoked/expired → reject with 403

---

## Prerequisites

### System Requirements
- **Node.js** 20+ (check with `node --version`)
- **npm** 10+ (check with `npm --version`)
- **Optional**: Docker & Docker Compose (for simplified local dev)

### Verify Installation
```bash
node --version    # Should output v20.x.x or higher
npm --version     # Should output 10.x.x or higher
```

### If Not Installed
- **macOS**: `brew install node@20`
- **Windows**: Download from [nodejs.org](https://nodejs.org)
- **Linux**: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs`

---

## Step 1: Project Setup

### 1.1 Clone (or Navigate to) the Repository

```bash
cd c:\code\VideoPlayer    # Already in this directory for this guide
```

### 1.2 Verify Directory Structure

```bash
ls -la    # On Windows: dir
```

You should see:
```
├── platform/           # Next.js Platform App
├── hls-server/         # Express.js HLS Media Server
├── shared/             # Shared types & utilities
├── scripts/            # Helper scripts (password hashing, etc.)
├── .env.example        # Environment variable template
├── package.json        # Root workspace config
├── README.md           # Project README
├── PDR.md              # Full product specification
└── DEPLOYMENT.md       # Deployment guide
```

### 1.3 Install Root Dependencies

```bash
npm install
```

This installs dependencies for all three workspaces (shared, platform, hls-server).

---

## Step 2: Environment Configuration

Environment variables tell each service where to find the other service, what signing secret to use, and how to behave in dev vs. production.

### 2.1 Create the `.env` File

```bash
cp .env.example .env
```

### 2.2 Edit the `.env` File

Open `.env` in your editor. You'll see:

```bash
# === Shared (CRITICAL: Must match both services) ===
PLAYBACK_SIGNING_SECRET=         # You'll generate this in Step 3
INTERNAL_API_KEY=                # You'll generate this in Step 3

# === Platform App ===
DATABASE_URL=file:./dev.db       # SQLite for local dev (auto-created)
ADMIN_PASSWORD_HASH=             # You'll generate this in Step 3
HLS_SERVER_BASE_URL=http://localhost:4000
NEXT_PUBLIC_APP_NAME=StreamGate
SESSION_TIMEOUT_SECONDS=60

# === HLS Media Server ===
PLATFORM_APP_URL=http://localhost:3000
STREAM_ROOT=./streams
UPSTREAM_ORIGIN=                 # Leave blank for local-only
SEGMENT_CACHE_ROOT=
SEGMENT_CACHE_MAX_SIZE_GB=50
SEGMENT_CACHE_MAX_AGE_HOURS=72
REVOCATION_POLL_INTERVAL_MS=30000
CORS_ALLOWED_ORIGIN=http://localhost:3000
PORT=4000
```

### 2.3 Generate Secrets

You need three random secrets:
1. **PLAYBACK_SIGNING_SECRET** — 32+ random characters (HMAC signing key)
2. **INTERNAL_API_KEY** — Random string for internal endpoint protection
3. **ADMIN_PASSWORD_HASH** — Bcrypt hash of your admin password

The next step will handle this.

---

## Step 3: Generate Admin Password Hash

### 3.1 Run the Password Hashing Script

```bash
npm run hash-password
```

Follow the prompt:
```
Enter password: ___________
Confirm password: ___________

Output:
ADMIN_PASSWORD_HASH=<long bcrypt hash starting with $2a$>
```

### 3.2 Generate PLAYBACK_SIGNING_SECRET

Generate a 32+ character random string. Use any of these methods:

**Method 1: PowerShell (easiest on Windows)**
```powershell
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

**Method 2: Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Method 3: OpenSSL**
```bash
openssl rand -base64 32
```

### 3.3 Generate INTERNAL_API_KEY

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### 3.4 Update `.env` File

Edit `.env` and fill in the three values:

```bash
PLAYBACK_SIGNING_SECRET=<your-32-char-secret>
INTERNAL_API_KEY=<your-random-string>
ADMIN_PASSWORD_HASH=<output-from-hash-password>
```

**⚠️ CRITICAL**: The same `PLAYBACK_SIGNING_SECRET` value **must** appear in both services. When you start the services, they will share this secret automatically.

---

## Step 4: Database Initialization

The Platform App uses Prisma ORM to manage the database. By default, it uses SQLite (`dev.db`) for local development.

### 4.1 Run Migrations

Migrations create the database schema (tables for Events, Tokens, ActiveSessions, etc.):

```bash
cd platform
set -a
source ../.env
set +a
npx prisma migrate dev --name init
npx prisma generate
```

Prisma v7 reads the datasource from `platform/prisma.config.ts`, so `DATABASE_URL` must be available in the shell before running the migrate command.
The `npx prisma generate` step creates `platform/src/generated/prisma/*`, which the app imports at runtime.

First run will:
1. Create `dev.db` in the `platform/` directory
2. Apply all migrations (creating tables)
3. Optionally seed sample data

When prompted:
```
? Do you want to continue? [Y/n] › y
```

### 4.2 (Optional) Seed Sample Data

Populate the database with test events and tokens:

```bash
npx prisma db seed
```

This runs `platform/prisma/seed.ts`, which creates:
- 2 test events
- 5 test tokens per event
- Timestamps for demo purposes

### 4.3 Inspect the Database (Optional)

Open Prisma Studio to visually browse the database:

```bash
npx prisma studio
```

This opens a web UI at `http://localhost:5555` showing all records. Useful for debugging!

---

## Step 5: Prepare Test Streams

HLS requires actual video stream files. For local testing, you need at least:
- A playlist file (`stream.m3u8`)
- Media segment files (`segment-000.ts`, `segment-001.ts`, etc.)

### 5.1 Understand Stream Directory Structure

The HLS server expects streams at:
```
hls-server/streams/
└── <event-id>/
    ├── stream.m3u8          # HLS playlist
    ├── segment-000.ts       # First 2-second segment
    ├── segment-001.ts       # Second segment
    └── ... more segments
```

The `<event-id>` matches the Event ID in the database.

### 5.2 Create Test Stream Directory

Assuming you seeded the database, it created an event with ID `847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2`. Create the stream directory:

```bash
mkdir -p hls-server/streams/847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2
```

### 5.3 Create Test Playlist File

Create `hls-server/streams/847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2/stream.m3u8`:

```m3u8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXTINF:2.0,
segment-000.ts
#EXTINF:2.0,
segment-001.ts
#EXTINF:2.0,
segment-002.ts
#EXTINF:2.0,
segment-003.ts
#EXT-X-ENDLIST
```

### 5.4 Create Test Media Segments (Minimal Dummy Files)

For testing JWT validation without actual video, create minimal TS files:

```bash
# PowerShell on Windows
cd hls-server/streams/847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2

# Create empty segment files (minimal valid TS container)
foreach ($i in 0..7) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes("dummy-segment-$i")
  [System.IO.File]::WriteAllBytes("segment-00$i.ts", $bytes)
}
```

Or on **macOS/Linux**:
```bash
cd hls-server/streams/847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2
for i in {0..7}; do echo "dummy-segment-$i" > segment-00$i.ts; done
```

### 5.5 Verify Stream Directory

```bash
ls -la hls-server/streams/847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2/
```

You should see:
```
stream.m3u8
segment-000.ts
segment-001.ts
... segment-007.ts
```

---

## Step 6: Start the Services

You need **two terminal windows** (or tabs) — one for each service. They run independently.

### Terminal 1: Start the Platform App (Next.js)

```bash
cd platform
set -a
source ../.env
set +a
PORT=3000 npm run dev
```

Use `PORT=3000` here because the shared root `.env` includes `PORT=4000` for the HLS server.

Expected output:
```
> next dev

  ▲ Next.js 14.2.0
  - Local:        http://localhost:3000
  - Environments: .env

✓ Ready in 1203ms
```

The Platform App is now running at **`http://localhost:3000`**

### Terminal 2: Start the HLS Media Server (Express)

```bash
cd hls-server
set -a
source ../.env
set +a
npm run dev
```

Expected output:
```
HLS Media Server listening on port 4000
Revocation sync started with interval 30000ms
```

The HLS Media Server is now running at **`http://localhost:4000`**

### Verify Both Services Are Running

**Test the Platform App:**
```bash
curl http://localhost:3000/
# Should return HTML (Next.js page)
```

**Test the HLS Server Health Endpoint:**
```bash
curl http://localhost:4000/health
# Should return JSON like: {"status":"ok","database":"connected","cache":"ready"}
```

---

## Step 7: Using the System

Now that both services are running, let's walk through a complete user journey.

### 7.1 Access the Viewer Portal

Open your browser and navigate to:
```
http://localhost:3000
```

You should see:
- A **Token Entry** screen with an input field
- Branding (default: "StreamGate" or your custom `NEXT_PUBLIC_APP_NAME`)
- Instructions: "Enter your access token"

### 7.2 Get a Token (From Admin Console or Database)

You have two ways to get a token:

**Option A: Use a Seeded Token (If you ran `npx prisma db seed`)**

If you seeded the database, tokens were auto-generated. You can find them by:

```bash
cd platform
npx prisma studio
```

Then navigate to the **Token** table. Copy any token with `isRevoked = false`.

Example token codes: `ABC123DEF456`, `XYZ789UVW012`, etc.

**Option B: Generate a New Token via the Admin Console**

This is covered in **Step 7.4** below.

### 7.3 Enter Token and Watch Stream

1. Back in the **Viewer Portal**, paste a token code into the input field.
2. Click **"Start Watching"** (or press Enter).
3. If valid, you'll be taken to the **Player Screen** showing:
   - A full-screen HLS video player
   - Stream controls (play, pause, volume, fullscreen, seek)
   - A **back button** to enter a new token
   - A **countdown timer** showing time until token expires

4. The player will:
   - Fetch the playlist (`stream.m3u8`) from the HLS server
   - Attach your JWT to every request (`Authorization: Bearer <jwt>`)
   - Stream segments (`segment-000.ts`, etc.)
   - Auto-refresh the JWT every 50 minutes to keep it alive
   - Send heartbeat every 30 seconds to maintain the active session

5. Close the tab or click the **back button** to release the session (allowing another device to use the token).

### 7.4 Access the Admin Console

#### 7.4.1 Login to Admin

Navigate to:
```
http://localhost:3000/admin
```

You'll see a **Login** page. Enter your admin password (the one you hashed in **Step 3**).

**Expected login credentials:**
- Username: `admin` (implicit, auto-filled)
- Password: `<your-password-you-chose-in-step-3>`

#### 7.4.2 Admin Dashboard

After login, you'll see the **Admin Console** with three sections:

**A. Events Tab**

- **List of all streaming events** (live & archived)
- **Create Event** form:
  - Title: Name of the event
  - Description: Details about the stream
  - Starts At / Ends At: Time window
  - Stream URL: Local path (e.g., `./streams/event-id/`) or upstream origin
  - Poster Image URL: Thumbnail
  - Access Window: Hours from `endsAt` when tokens are still valid (e.g., 48 hours)
  - **Actions**: Archive, Deactivate, Delete

Deactivating an event immediately revokes all active tokens for that event.

**B. Tokens Tab**

- **List of all tokens** for the selected event
- **Generate New Tokens** form:
  - Event: Select target event
  - Quantity: Number of tokens to generate (1–1000)
  - **Auto-generated**: 12-character alphanumeric codes
  - **Actions**: Copy, Revoke, Delete

Once a token is revoked, it's blocked on the HLS server immediately (≤30 seconds).

**C. Revocations Tab** (if available)

- Shows recently revoked tokens and deactivated events
- Useful for debugging revocation sync

#### 7.4.3 Example: Create an Event and Tokens

1. **Create Event:**
   - Title: "Live Concert 2026"
   - Starts At: `2026-03-05 14:00:00`
   - Ends At: `2026-03-05 15:30:00`
   - Access Window: `48` hours
   - Click **"Create"**

2. **Generate Tokens:**
   - Select the event from the dropdown
   - Quantity: `5`
   - Click **"Generate"**
   - Tokens appear in the list (e.g., `K7F2X9M4B1C3`)

3. **Distribute Tokens:**
   - Copy each token code
   - Share via email, QR code, or print

4. **Viewer Uses Token:**
   - Viewer enters the token on the **Viewer Portal**
   - Portal validates against the database
   - Portal issues a JWT
   - Viewer can now watch the stream

---

## API Reference

### Platform App APIs

#### 1. **POST /api/tokens/validate**
*Validate an access token and get a playback JWT*

**Request:**
```json
{
  "code": "K7F2X9M4B1C3"
}
```

**Response (200 OK):**
```json
{
  "data": {
    "accessToken": "eyJhbGci...",
    "tokenType": "Bearer",
    "expiresIn": 3600,
    "eventId": "847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2",
    "streamPath": "/streams/847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2/"
  }
}
```

**Error Responses:**
- `400` — Invalid/missing code
- `404` — Token not found
- `410` — Token expired
- `409` — Token already in use (single-device enforcement)
- `403` — Token revoked or event deactivated

#### 2. **POST /api/playback/refresh**
*Refresh a nearly-expired JWT*

**Request:**
```
Authorization: Bearer <jwt>
```

**Response (200 OK):**
```json
{
  "data": {
    "accessToken": "eyJhbGci...",
    "expiresIn": 3600
  }
}
```

#### 3. **POST /api/playback/heartbeat**
*Update session's lastHeartbeat timestamp (keep session alive)*

**Request:**
```
Authorization: Bearer <jwt>
```

**Response (200 OK):**
```json
{
  "data": {
    "status": "ok",
    "lastHeartbeat": 1741200000
  }
}
```

#### 4. **POST /api/playback/release**
*Release the active session (free up the token for another device)*

**Request:**
```
Authorization: Bearer <jwt>
```

**Response (200 OK):**
```json
{
  "data": {
    "status": "released"
  }
}
```

#### 5. **GET /api/revocations?since=<timestamp>**
*Sync revoked tokens & deactivated events (INTERNAL, requires X-Internal-Api-Key header)*

**Request:**
```
GET /api/revocations?since=1741190000
X-Internal-Api-Key: <INTERNAL_API_KEY>
```

**Response (200 OK):**
```json
{
  "data": [
    {
      "type": "token_revocation",
      "code": "K7F2X9M4B1C3",
      "revokedAt": 1741195000
    },
    {
      "type": "event_deactivation",
      "eventId": "847fd0b6-xxx",
      "deactivatedAt": 1741195100
    }
  ]
}
```

### HLS Media Server APIs

#### 1. **GET /health**
*Health check (no auth required)*

**Response (200 OK):**
```json
{
  "status": "ok",
  "uptime": 12345,
  "cache": { "size": 15, "hits": 1000, "misses": 50 },
  "lastSync": 1741200000
}
```

#### 2. **GET /streams/:eventId/stream.m3u8**
*Fetch HLS playlist (requires valid JWT)*

**Request:**
```
GET /streams/847fd0b6-3ac3-48a8-9027-d7b7d09fb9a2/stream.m3u8
Authorization: Bearer <jwt>
```

**Response (200 OK):**
```m3u8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXTINF:2.0,
segment-000.ts
#EXTINF:2.0,
segment-001.ts
...
#EXT-X-ENDLIST
```

**Error Responses:**
- `401` — Missing or invalid JWT
- `403` — Token revoked, event deactivated, or path mismatch
- `410` — JWT expired

#### 3. **GET /streams/:eventId/segment-NNN.ts**
*Fetch media segment (requires valid JWT)*

Same as above — every segment request requires a valid JWT in the `Authorization` header.

---

## Common Tasks

### Task 1: Create a New Event and Generate Tokens

1. **Log in** to Admin Console (`http://localhost:3000/admin`)
2. Go to **Events** tab
3. Fill in the form:
   - Title: `"My Live Event"`
   - Starts At: `2026-03-05 18:00:00`
   - Ends At: `2026-03-05 19:00:00`
   - Access Window: `24` (hours after `endsAt`)
   - Click **Create**
4. Go to **Tokens** tab
5. Select your new event from the dropdown
6. Enter `Quantity: 10`
7. Click **Generate**
8. Tokens appear in the list — copy and distribute

### Task 2: Revoke a Token

1. **Log in** to Admin Console
2. Go to **Tokens** tab
3. Find the token you want to revoke
4. Click the **Revoke** button next to it
5. Token is immediately revoked — viewers using it will see "access ended" within 30 seconds

### Task 3: Deactivate an Event

1. **Log in** to Admin Console
2. Go to **Events** tab
3. Find the event
4. Click **Deactivate**
5. All tokens for that event are immediately revoked (within 30 seconds)

### Task 4: Upload Real Video Streams

For production, you need actual HLS-encoded video files:

1. **Encode video to HLS** using FFmpeg:
   ```bash
   ffmpeg -i input.mp4 -c:v libx264 -c:a aac -f hls \
     -hls_time 2 -hls_playlist_type event \
     -hls_segment_filename "segment-%03d.ts" \
     stream.m3u8
   ```

2. **Place in streams directory:**
   ```bash
   cp stream.m3u8 segment-*.ts hls-server/streams/<event-id>/
   ```

3. **Or use upstream proxy** (set `UPSTREAM_ORIGIN` in `.env` to upstream server URL, and HLS server will proxy segments)

### Task 5: Reset the Database

To clear all events, tokens, and sessions:

```bash
cd platform
rm dev.db                         # Delete the SQLite database
npx prisma migrate dev            # Re-run migrations to create new empty DB
npx prisma db seed                # (Optional) Re-seed with test data
```

### Task 6: Check Database Contents

Visually inspect all records:

```bash
cd platform
npx prisma studio
```

Opens `http://localhost:5555` showing all tables, records, and relationships.

---

## Troubleshooting

### Issue 1: Port 3000 or 4000 Already in Use

**Symptom:**
```
error: listen EADDRINUSE: address already in use :::3000
```

**Solution:**

**Kill the process using the port:**

Windows PowerShell:
```powershell
Get-Process -Name "node" | Stop-Process -Force
```

macOS/Linux:
```bash
lsof -ti:3000 | xargs kill -9  # Platform App
lsof -ti:4000 | xargs kill -9  # HLS Server
```

Then restart the services.

### Issue 2: "Token Code Not Found" or "Invalid Token"

**Symptoms:**
- Viewer enters token, gets "Token not found" error
- Token was just generated but doesn't work

**Causes:**
1. Token code has typo or wrong case (should be case-sensitive)
2. Event is archived or deactivated
3. Token is already revoked
4. Token doesn't exist in database

**Solution:**
1. **Verify token exists:**
   ```bash
   cd platform
   npx prisma studio
   # Check Tokens table for the code you entered
   ```

2. **Check token status:**
   - If `isRevoked = true`, token is revoked
   - If `expiresAt` is in the past, token is expired
   - Make sure event `isActive = true`

3. **Re-generate a fresh token:**
   - Go to Admin Console → Tokens tab
   - Select the event
   - Generate new tokens
   - Use the new code immediately

### Issue 3: "Player Won't Load Streams" or "Stream at 0%"

**Symptoms:**
- Video player opens but stays at 0%
- Console shows 404 or 403 errors on `.m3u8` request

**Causes:**
1. Stream files not in correct directory
2. JWT validation failing (secret mismatch)
3. `HLS_SERVER_BASE_URL` misconfigured
4. HLS server not running

**Solution:**

1. **Verify HLS server is running:**
   ```bash
   curl http://localhost:4000/health
   # Should return JSON with status: "ok"
   ```

2. **Check stream directory exists:**
   ```bash
   ls -la hls-server/streams/<event-id>/
   # Should show stream.m3u8 and segment files
   ```

3. **Verify PLAYBACK_SIGNING_SECRET matches** in both `.env` files:
   ```bash
   grep PLAYBACK_SIGNING_SECRET platform/.env
   grep PLAYBACK_SIGNING_SECRET hls-server/.env
   # Should output identical values
   ```

4. **Check HLS server logs:**
   Look for JWT validation errors in Terminal 2. Verify JWT signature is being validated correctly.

5. **Test JWT manually:**
   ```bash
   # Get a JWT first
   curl -X POST http://localhost:3000/api/tokens/validate \
     -H "Content-Type: application/json" \
     -d '{"code":"<your-token-code>"}'
   
   # Then test with that JWT on HLS server
   curl -H "Authorization: Bearer <jwt-from-above>" \
     http://localhost:4000/streams/<event-id>/stream.m3u8
   # Should return the .m3u8 content, not 403
   ```

### Issue 4: "Revocation Not Working" (Token Stays Valid After Revoke)

**Symptom:**
- You revoke a token in Admin Console
- Viewer can still use the token for >30 seconds

**Cause:**
HLS server caches revocations for the interval. Revocation propagation is **eventual consistent**:
- Maximum delay: `REVOCATION_POLL_INTERVAL_MS` (default: 30 seconds)
- HLS server polls Platform App for revoked tokens every 30 seconds

**Solution:**
1. This is **by design** — the trade-off for sub-millisecond JWT validation
2. If you need instant revocation, reduce `REVOCATION_POLL_INTERVAL_MS` in `.env` (HLS server):
   ```bash
   REVOCATION_POLL_INTERVAL_MS=5000  # Poll every 5 seconds instead of 30
   ```
3. Then restart the HLS server

### Issue 5: "Admin Password Incorrect"

**Symptom:**
- Can't log in to Admin Console
- "Incorrect password" message

**Solution:**

1. **Verify password hash is in `.env`:**
   ```bash
   grep ADMIN_PASSWORD_HASH .env
   # Should show a hash starting with $2a$ or $2b$
   ```

2. **Re-generate hash if needed:**
   ```bash
   npm run hash-password
   # Enter your desired password again
   # Copy the output to .env
   ```

3. **Restart Platform App:**
   - Stop the running `npm run dev` in Terminal 1
   - Update `.env`
   - Restart the Platform App
   - Try logging in again

### Issue 6: Database Locked / Migration Issues

**Symptom:**
```
Error: database is locked
```

**Solution:**

1. **Stop all services:**
   ```powershell
   Get-Process -Name "node" | Stop-Process -Force
   ```

2. **Remove database file:**
   ```bash
   rm platform/dev.db*
   ```

3. **Re-run migration:**
   ```bash
   cd platform
   npx prisma migrate dev
   ```

4. **Restart services**

### Issue 7: "CORS Error" When Calling API

**Symptom:**
```
Access to XMLHttpRequest blocked by CORS policy
```

**Solutions:**

1. **Verify `CORS_ALLOWED_ORIGIN` in HLS server `.env`:**
   ```bash
   CORS_ALLOWED_ORIGIN=http://localhost:3000
   ```

2. **Restart HLS server** so changes take effect

3. **In development**, if using a proxy or different port, adjust `CORS_ALLOWED_ORIGIN` accordingly

---

## Next Steps

After you've got the system running locally:

1. **Read the [PDR.md](PDR.md)** for full API contracts and database schema
2. **Review [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)** for development task breakdown
3. **Check [DEPLOYMENT.md](DEPLOYMENT.md)** for production deployment (Docker, cloud platforms, etc.)
4. **Explore the code** in `platform/src`, `hls-server/src`, and `shared/src`
5. **Write tests** for custom features

---

## Support & Debugging

### Useful Commands

```bash
# Check Node.js version
node --version

# View environment variables loaded
grep -v "^#" .env | grep -v "^$"

# Kill all Node processes
killall node            # macOS/Linux
Get-Process node | Stop-Process -Force  # Windows PowerShell

# View active connections on ports
lsof -i:3000 -i:4000   # macOS/Linux
netstat -ano | findstr ":3000\|:4000"  # Windows

# Clean install dependencies
rm -rf node_modules package-lock.json
npm install

# Type-check without running
npm run typecheck       # In platform/ or hls-server/

# Lint code
npm run lint            # In root
```

### Logs to Check

1. **Platform App logs** (Terminal 1):
   - Look for `ready`, `compiled`, or error messages
   - Check for API routes being loaded

2. **HLS Server logs** (Terminal 2):
   - Look for `listening on port 4000`
   - Check for revocation sync starting
   - Watch for JWT validation errors when streaming

3. **Browser console** (`F12` in viewer/admin):
   - Check for fetch/XHR errors
   - Look for JWT issues or CORS errors
   - Check video player (hls.js) errors

---

**You're all set! Start with Step 1 if you haven't already, and work through each section sequentially.** 🚀
