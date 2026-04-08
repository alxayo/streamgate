---
sidebar_position: 2
title: Quick Start (5 Minutes)
---

# Quick Start — Zero to Streaming in 5 Minutes

This guide gets you from nothing to watching a live, token-gated stream as fast as possible.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| **Node.js** | 20+ | `node --version` |
| **npm** | 10+ | `npm --version` |
| **FFmpeg** | Any recent | `ffmpeg -version` |
| **Git** | Any | `git --version` |

:::tip Don't have FFmpeg?
On macOS: `brew install ffmpeg` · On Windows: `winget install ffmpeg` · On Ubuntu: `sudo apt install ffmpeg`
:::

## Step 1: Clone & Install

```bash
git clone https://github.com/your-username/VideoPlayer.git
cd VideoPlayer
npm install
```

This installs all dependencies for both services (the monorepo uses npm workspaces).

## Step 2: Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Now generate the three required secrets:

**Generate `PLAYBACK_SIGNING_SECRET`** (shared HMAC key):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Generate `INTERNAL_API_KEY`** (inter-service auth):

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

**Generate `ADMIN_PASSWORD_HASH`** (choose your admin password):

```bash
npm run hash-password
```

This will prompt you for a password and output a bcrypt hash.

Edit `.env` and paste the three values:

```env
PLAYBACK_SIGNING_SECRET=<paste base64 string>
INTERNAL_API_KEY=<paste hex string>
ADMIN_PASSWORD_HASH=<paste bcrypt hash>
```

:::warning Keep secrets consistent
`PLAYBACK_SIGNING_SECRET` and `INTERNAL_API_KEY` must be identical in both `platform/.env` and `hls-server/.env`. The root `.env` file is used by both services during development.
:::

## Step 3: Initialize the Database

```bash
cd platform
npx prisma migrate dev --name init
cd ..
```

This creates the SQLite database and applies all migrations.

## Step 4: Start Both Services

Open **two terminals**:

```bash
# Terminal 1 — Platform App (port 3000)
cd platform
npm run dev
```

```bash
# Terminal 2 — HLS Media Server (port 4000)
cd hls-server
npm run dev
```

:::info
Wait for both services to show "ready" messages before proceeding.
:::

## Step 5: Create an Event & Generate Tokens

1. Open **http://localhost:3000/admin** in your browser
2. Log in with the admin password you chose in Step 2
3. Click **"Create Event"**
4. Fill in the form:
   - **Title**: "My First Stream"
   - **Starts At**: Set to the current time (or a few minutes ago)
   - **Ends At**: Set to a few hours from now
   - Leave other fields at their defaults
5. Save the event — note the **Event ID** (UUID) shown on the event detail page
6. Click **"Generate Tokens"**
7. Generate 1 or more tokens
8. **Copy one of the token codes** (12-character alphanumeric string)

## Step 6: Start Streaming with FFmpeg

Create the stream directory and start FFmpeg. Replace `EVENT_ID` with the UUID from Step 5:

```bash
# Create the stream output directory
mkdir -p hls-server/streams/EVENT_ID
```

:::tip Windows Users
Use `mkdir hls-server\streams\EVENT_ID` instead (no `-p` flag needed).
:::

**Option A — Test pattern (no camera needed):**

```bash
ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=440:sample_rate=44100 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "hls-server/streams/EVENT_ID/segment-%03d.ts" \
  "hls-server/streams/EVENT_ID/stream.m3u8"
```

**Option B — RTMP ingest (e.g., OBS sending to `rtmp://localhost/live/stream`):**

```bash
ffmpeg -listen 1 -i rtmp://0.0.0.0:1935/live/stream \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "hls-server/streams/EVENT_ID/segment-%03d.ts" \
  "hls-server/streams/EVENT_ID/stream.m3u8"
```

You should see FFmpeg output scrolling — it's generating HLS segments.

:::warning Replace EVENT_ID
The directory name **must** match the event's UUID exactly. For example, if your event ID is `a1b2c3d4-e5f6-7890-abcd-ef1234567890`, your path would be `hls-server/streams/a1b2c3d4-e5f6-7890-abcd-ef1234567890/`.
:::

## Step 7: Watch the Stream! 🎉

1. Open **http://localhost:3000** in your browser
2. Enter the **token code** you copied in Step 5
3. Click **"Watch"**
4. Your stream should start playing!

You're now running a fully token-gated live stream with JWT-secured HLS delivery.

---

## Docker Alternative

Prefer containers? Skip Steps 2–4 and run:

```bash
docker-compose up --build
```

This starts both services pre-configured with development defaults. The admin password is `admin123`.

Then continue from **Step 5** above to create events and tokens.

:::info Docker stream directory
When using Docker, place stream files in the `./streams/` directory at the project root — it's mounted into the HLS server container at `/streams`.
:::

---

## What's Next?

| Topic | Link |
|-------|------|
| Full installation & config | [Manual Setup](./installation/manual-setup.md) |
| Managing events & tokens | [Admin Console](./admin-console.md) |
| FFmpeg streaming in depth | [Live Streaming with FFmpeg](./streaming-with-ffmpeg.md) |
| All environment variables | [Configuration Reference](./configuration.md) |
| Something not working? | [Troubleshooting](./troubleshooting.md) |
