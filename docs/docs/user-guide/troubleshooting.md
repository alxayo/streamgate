---
sidebar_position: 9
title: Troubleshooting
---

# Troubleshooting

Common issues and their solutions, organized by symptom. Start with the symptom you're seeing, then follow the diagnostic steps and fix.

---

## Installation & Setup Issues

### Port Already in Use

**Symptom:** Error on startup — `EADDRINUSE: address already in use :::3000` or `:::4000`.

**Cause:** Another process is already using the port.

**Fix:**

```bash
# Find what's using the port (Linux/macOS)
lsof -i :3000
lsof -i :4000

# Find what's using the port (Windows)
netstat -ano | findstr :3000
netstat -ano | findstr :4000
```

Then either stop the conflicting process or change the port:

```env
# For HLS server, change PORT in hls-server/.env
PORT=4001

# For Platform App, use a different port
# In platform/package.json, update the dev script or set:
# PORT=3001 npm run dev
```

### Database Migration Errors

**Symptom:** `npx prisma migrate dev` fails with errors.

**Cause:** Usually a corrupted database file or a schema conflict.

**Fix:**

```bash
cd platform

# Option 1: Reset the database (deletes all data)
npx prisma migrate reset

# Option 2: Delete the database file and re-run migrations
rm prisma/dev.db
npx prisma migrate dev --name init
```

:::warning Data loss
Both options delete all existing data. For production databases, consult the [Prisma migration docs](https://www.prisma.io/docs/concepts/components/prisma-migrate) for safe migration strategies.
:::

### npm Install Fails

**Symptom:** `npm install` errors related to workspaces or dependencies.

**Fix:**

```bash
# Clear npm cache and node_modules
rm -rf node_modules package-lock.json
rm -rf platform/node_modules hls-server/node_modules shared/node_modules
npm install

# On Windows
Remove-Item -Recurse -Force node_modules, package-lock.json
Remove-Item -Recurse -Force platform\node_modules, hls-server\node_modules, shared\node_modules
npm install
```

Ensure you're using Node.js 20+:

```bash
node --version
# Must be v20.x.x or higher
```

---

## Authentication Issues

### Admin Password Incorrect

**Symptom:** Can't log in to the admin console at `/admin`.

**Cause:** Mismatch between the password you're entering and the `ADMIN_PASSWORD_HASH`.

**Fix:**

1. Generate a new hash for your desired password:
   ```bash
   npm run hash-password
   ```
2. Copy the full hash output (starts with `$2b$12$...`)
3. Update `ADMIN_PASSWORD_HASH` in your `.env` file
4. Restart the Platform App

:::tip Common mistake
Make sure the hash is not truncated when pasting. bcrypt hashes are exactly 60 characters long and contain special characters (`$`, `/`) that some shells may interpret. Wrap the value in quotes if needed.
:::

### "Invalid access code"

**Symptom:** Viewer enters a token code but gets "Invalid access code".

**Diagnostic steps:**
1. Verify the code is exactly 12 characters, alphanumeric only (a-z, A-Z, 0-9)
2. Check for leading/trailing whitespace (common with copy-paste)
3. In the admin console, verify the token exists and is not revoked
4. Verify the event is active (`isActive: true`)

### "Access code has been revoked"

**Symptom:** A previously-working code now shows as revoked.

**Cause:** An admin revoked the token.

**Fix:** In the admin console, find the token and click **"Un-revoke"** / **"Restore"** to re-enable it.

### "Access code has expired"

**Symptom:** Code was valid before but now shows as expired.

**Cause:** The event's access window has closed. Token expiry = `event.endsAt + event.accessWindowHours`.

**Fix:** In the admin console, edit the event to extend the `endsAt` time or increase `accessWindowHours`. Existing tokens will reflect the new window.

### "This code is already in use"

**Symptom:** Viewer gets "token in use" even though no one else is watching.

**Cause:** A previous session wasn't properly released (browser crash, network disconnect).

**Fix (viewer):** Wait up to 60 seconds (default `SESSION_TIMEOUT_SECONDS`) for the abandoned session to expire automatically.

**Fix (admin):** In the admin console, find the token's active session and click **"Release Session"** to free it immediately.

---

## Streaming & Playback Issues

### Player Won't Load / Infinite Spinner

**Symptom:** Token is accepted but the video player shows a loading spinner indefinitely.

**Diagnostic steps:**

1. **Check FFmpeg is running** — Are `.m3u8` and `.ts` files being generated?
   ```bash
   ls -la hls-server/streams/EVENT_ID/
   ```

2. **Check the HLS server is running** — Can you reach it?
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/streams/EVENT_ID/stream.m3u8
   # 401 = server running (JWT required)
   # Connection refused = server not running
   ```

3. **Check PLAYBACK_SIGNING_SECRET matches** — The most common cause. If the secrets differ between services, JWTs minted by the Platform App will be rejected by the HLS server.

4. **Check browser console** — Open DevTools (F12) → Console tab. Look for:
   - `401` errors on `.m3u8` requests → JWT validation failing
   - `403` errors → Token is revoked
   - `404` errors → Stream files not found at expected path
   - CORS errors → See CORS section below

### PLAYBACK_SIGNING_SECRET Mismatch

**Symptom:** Token validation succeeds (viewer gets to the player), but the video never loads. Browser console shows `401` errors on HLS requests.

**Cause:** The Platform App and HLS server are using different signing secrets. The JWT is signed correctly by one service but can't be verified by the other.

**Fix:**

1. Ensure `PLAYBACK_SIGNING_SECRET` is identical in both:
   - `platform/.env` (or root `.env`)
   - `hls-server/.env` (or root `.env`)
2. Restart both services after updating

:::tip Quick check
Generate a new secret and set it in both `.env` files at the same time:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
:::

### Stream Shows Black Screen / No Video

**Symptom:** Player loads but shows a black screen.

**Causes:**
- FFmpeg is not writing to the correct directory
- The event ID in the directory name doesn't match the event in the database
- FFmpeg crashed or was stopped

**Fix:**
1. Verify the event ID: open the admin console, click on the event, and check the ID (UUID)
2. Verify the stream directory: `ls hls-server/streams/` — the directory name must match the event ID exactly
3. Verify FFmpeg is running and producing output
4. Check that `stream.m3u8` exists and has recent content:
   ```bash
   cat hls-server/streams/EVENT_ID/stream.m3u8
   ```

### Revocation Not Working Immediately

**Symptom:** A token was revoked in the admin console, but the viewer can still watch for a while.

**Cause:** This is **by design**. The HLS server polls for revocation updates every 30 seconds (`REVOCATION_POLL_INTERVAL_MS`). There is a maximum 30-second delay before a revoked token is blocked.

**What to expect:**
- The token is immediately marked as revoked in the database
- Within 30 seconds, the HLS server picks up the revocation
- The viewer's next segment request after that is blocked (403)
- The viewer sees a "playback stopped" message

**Need faster revocation?** Reduce the poll interval:
```env
REVOCATION_POLL_INTERVAL_MS=5000   # 5 seconds instead of 30
```

:::info Trade-off
Lower poll intervals mean faster revocation but more API calls from the HLS server to the Platform App. At 5 seconds, the HLS server makes 12 requests per minute instead of 2.
:::

### "Too many attempts" / Rate Limiting

**Symptom:** Viewer sees "Too many attempts" when entering a token code.

**Cause:** Rate limit hit — 5 validation attempts per minute per IP address.

**Fix:** Wait 60 seconds and try again. This limit protects against brute-force token guessing.

If this affects legitimate users (e.g., behind a shared IP / NAT), consider deploying behind a load balancer that sets proper `X-Forwarded-For` headers.

---

## CORS Errors

**Symptom:** Browser console shows errors like:
```
Access to XMLHttpRequest at 'http://localhost:4000/...' from origin 'http://localhost:3000' has been blocked by CORS policy
```

**Cause:** The `CORS_ALLOWED_ORIGIN` on the HLS server doesn't match the origin the browser is using.

**Fix:**

1. Check the URL in your browser's address bar (the Platform App URL)
2. Set `CORS_ALLOWED_ORIGIN` to match exactly. For multiple origins, use comma-separated values:
   ```env
   # Single origin
   CORS_ALLOWED_ORIGIN=http://localhost:3000

   # Multiple origins (e.g., localhost + LAN IP)
   CORS_ALLOWED_ORIGIN=http://localhost:3000,http://192.168.0.11:3000
   ```
3. Restart the HLS server

:::warning Exact match required
`http://localhost:3000` and `http://127.0.0.1:3000` are **different origins**. Use whichever one matches your browser's address bar. When accessing from a LAN IP, add that origin to `CORS_ALLOWED_ORIGIN` as a comma-separated entry.
:::

---

## LAN / Network Access Issues

### Buttons Disabled / Page Not Interactive on LAN IP

**Symptom:** Accessing StreamGate via a LAN IP (e.g., `http://192.168.0.11:3000`) renders the page but buttons are disabled and inputs don't respond. Everything works fine on `localhost:3000`.

**Cause:** Next.js dev mode blocks cross-origin dev resource requests (HMR/React Server Components) from non-localhost origins by default. Without these resources, React cannot hydrate — event handlers never attach, leaving buttons visually rendered but non-functional.

**Fix:** StreamGate's `next.config.mjs` auto-detects LAN IPs and adds them to `allowedDevOrigins`. If this isn't working:

1. Verify `next.config.mjs` includes the `allowedDevOrigins` configuration
2. Restart the dev server after changing network configuration
3. Ensure the dev server binds to `0.0.0.0` (not just localhost):
   ```bash
   npx next dev --hostname 0.0.0.0
   ```

:::info Production not affected
This issue only affects Next.js dev mode. Production builds (`next start`) do not have this restriction.
:::

### Video Won't Play from LAN IP

**Symptom:** Token validation works from a LAN IP, but the video player shows a loading spinner or fails silently. Works fine on localhost.

**Causes:**
1. **CORS blocking** — The HLS server's `CORS_ALLOWED_ORIGIN` only includes `http://localhost:3000`, blocking requests from `http://192.168.0.11:3000`
2. **HLS server unreachable** — The HLS server may only be listening on `localhost` instead of `0.0.0.0`

**Fix:**

1. Add your LAN origin to `CORS_ALLOWED_ORIGIN`:
   ```env
   CORS_ALLOWED_ORIGIN=http://localhost:3000,http://192.168.0.11:3000
   ```
2. Ensure the HLS server binds to all interfaces (check `hls-server/src/index.ts` — it should use `0.0.0.0`)
3. Restart both services

:::tip Dynamic HLS URL
The Platform App automatically derives the HLS server URL from the viewer's request hostname. If you access via `192.168.0.11:3000`, the player will request streams from `192.168.0.11:4000`. You don't need to change `HLS_SERVER_BASE_URL` for LAN access.
:::

---

## Safari-Specific Issues

### Video Won't Play on Safari / iOS

**Symptom:** Video works on Chrome/Firefox but not on Safari.

**Cause:** Safari uses its native HLS player and handles `Authorization` headers differently for media requests.

**Expected behavior:** StreamGate automatically falls back to passing the JWT via a `__token` query parameter for Safari. This should happen transparently.

**If playback still fails:**
1. Check the browser console for errors
2. Ensure the Platform App is properly detecting Safari and using the query parameter fallback
3. Verify that `HLS_SERVER_BASE_URL` is accessible from the Safari device

### Autoplay Blocked on Safari

**Symptom:** Video shows a "Click to play" overlay instead of auto-playing.

**Cause:** Safari blocks autoplay of video with audio by default.

**This is expected.** The player shows a play button overlay — the viewer just needs to click once to start playback. This is a browser restriction, not a StreamGate issue.

---

## Docker-Specific Issues

### Containers Can't Communicate

**Symptom:** HLS server logs show failed revocation polls.

**Cause:** In Docker Compose, services use container names for internal communication, not `localhost`.

**Fix:** In `docker-compose.yml`, the `PLATFORM_APP_URL` for the HLS server should be `http://platform:3000` (using the service name), not `http://localhost:3000`.

### Stream Files Not Found in Docker

**Symptom:** Streams work in manual setup but not with Docker.

**Cause:** Stream directory path mismatch.

**Fix:** With Docker Compose, place stream files in `./streams/` at the project root (not `./hls-server/streams/`). The volume mount maps `./streams` → `/streams` inside the container.

---

## FFmpeg Issues

### FFmpeg Not Generating Segments

**Symptom:** FFmpeg is running but no `.ts` files appear.

**Diagnostic steps:**

1. Check FFmpeg output for errors
2. Verify the output directory exists:
   ```bash
   mkdir -p hls-server/streams/EVENT_ID
   ```
3. Check disk space:
   ```bash
   df -h .
   ```
4. Try a simpler command first:
   ```bash
   ffmpeg -re -f lavfi -i testsrc2 -f hls -hls_time 2 \
     -hls_segment_filename "hls-server/streams/EVENT_ID/seg-%03d.ts" \
     "hls-server/streams/EVENT_ID/stream.m3u8"
   ```

### FFmpeg "Address Already in Use" on RTMP

**Symptom:** `bind: Address already in use` when starting RTMP listener.

**Cause:** Port 1935 is already in use by another process (possibly another FFmpeg instance).

**Fix:**

```bash
# Find the process using port 1935
# Linux/macOS
lsof -i :1935

# Windows
netstat -ano | findstr :1935

# Kill the process or use a different port
ffmpeg -listen 1 -i rtmp://0.0.0.0:1936/live/stream ...
```

---

## Stream Configuration Issues

### Transcoder Using Default Config Instead of Per-Event Settings

**Symptom:** Stream uses system defaults even though per-event overrides were configured in the admin UI.

**Cause:** The HLS transcoder couldn't reach the Platform App's internal API, or the event ID in the stream key doesn't match the event ID in the database.

**Fix:**
1. Verify the transcoder has `-platform-url` and `-platform-api-key` flags set correctly
2. Check transcoder logs for `config_source` field — it should show `event` for per-event config, or `system-default` / `hardcoded` for fallback
3. Verify the RTMP stream key format is `live/{eventId}` where `{eventId}` matches the UUID in the admin console
4. Test the API directly: `curl -H "X-Internal-Api-Key: <key>" https://<platform>/api/internal/events/<id>/stream-config`

### High Latency Despite Low-Latency Settings

**Symptom:** Latency is still high (~15–20s) even after configuring `hlsTime: 2` and `liveSyncDurationCount: 2`.

**Cause:** The source encoder's keyframe interval may be longer than the segment duration. In copy/passthrough mode (1080p in Full ABR profile), FFmpeg can only cut segments at keyframes — so if the source sends keyframes every 4 seconds, segments will be ~4s regardless of `hlsTime`.

**Fix:**
1. Set your source encoder's keyframe interval to 1–2 seconds (in OBS: Settings → Output → Keyframe Interval = 1)
2. Use a rendition profile that transcodes all renditions (e.g., `low-latency-1080p-720p-480p`) — transcoded renditions use forced keyframes and respect `hlsTime` precisely

---

## Getting Help

If your issue isn't covered here:

1. **Check the logs** — Both services output detailed logs to the console
2. **Check the browser console** — Open DevTools (F12) for client-side errors
3. **Verify your configuration** — Run through the [Configuration Reference](./configuration.md) and ensure all required variables are set correctly
4. **Test each service independently** — Verify the Platform App works (admin login, token creation) before testing streaming
5. **Simplify** — Use the test pattern FFmpeg command to rule out source issues
