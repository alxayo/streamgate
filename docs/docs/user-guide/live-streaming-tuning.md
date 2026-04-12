---
sidebar_position: 8
title: Live Streaming Tuning Guide
---

# Live Streaming Tuning Guide

This guide explains how to reduce live streaming latency, optimize buffering, and choose the right configuration for your events. It connects settings across the entire pipeline — from FFmpeg encoding to HLS server delivery to the viewer's player — so you can make informed trade-offs.

**Who should read this:**

- **Operators** who want to adjust settings for their live events — start with the [Recommended Configuration Presets](#recommended-configuration-presets) section.
- **Technical users** who want to understand *why* each setting matters — read the full page, including the "Deep Dive" sections.

:::tip Already familiar with the basics?
This guide focuses on **tuning and trade-offs**. For initial setup, see [Live Streaming with FFmpeg](./streaming-with-ffmpeg.md). For a full list of environment variables, see [Configuration Reference](./configuration.md).
:::

---

## Understanding the Latency Pipeline

Every live stream passes through a chain of stages before reaching the viewer's screen. Each stage adds a small delay, and they accumulate:

```
Camera/Source
    │
    ▼
┌──────────────┐
│   FFmpeg      │  Encoding delay (preset + tune)
│   Encoding    │  + segment duration (-hls_time)
└──────┬───────┘
       │  writes .ts + .m3u8 files
       ▼
┌──────────────┐
│   Disk /      │  File I/O (write latency)
│   Storage     │
└──────┬───────┘
       │  HLS server reads files
       ▼
┌──────────────┐
│  HLS Media    │  JWT validation + content resolution
│  Server       │  + optional upstream fetch (proxy mode)
└──────┬───────┘
       │  HTTP response over network
       ▼
┌──────────────┐
│  Network      │  Transfer time (local network or internet)
│  Transfer     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  hls.js       │  Player buffering (sync point targeting)
│  Player       │  This is often the largest delay
└──────┬───────┘
       │
       ▼
   Viewer's Screen
```

### Typical Latency Breakdown

With StreamGate's default settings (2-second segments, default hls.js configuration):

| Stage | Typical Delay | Controllable? |
|-------|:------------:|:-------------:|
| FFmpeg encoding | 0.1–0.5s | ✅ Preset and tune |
| Segment duration | 2s | ✅ `-hls_time` |
| Disk I/O | &lt;0.1s (SSD) | ⚠️ Storage type |
| HLS server processing | &lt;0.01s | ❌ Negligible |
| Network transfer | 0.05–0.5s | ⚠️ Network dependent |
| **Player buffering** | **~6s** | ✅ hls.js settings |
| **Total** | **~6–8s** | |

The two biggest factors are **segment duration** (FFmpeg) and **player buffer depth** (hls.js). Tuning these has the most impact.

---

## FFmpeg Encoding Settings

This section explains how FFmpeg settings affect live streaming latency. For complete FFmpeg command examples and setup instructions, see [Live Streaming with FFmpeg](./streaming-with-ffmpeg.md).

### Segment Duration (`-hls_time`)

**This is the single most impactful setting for latency.**

The `-hls_time` value controls how many seconds of video go into each `.ts` segment file. The player cannot start playing a segment until it's fully written, so shorter segments mean lower latency — but with trade-offs.

| Value | Latency Impact | CPU/I/O Load | Best For |
|:-----:|:-------------:|:------------:|----------|
| `1` | Lowest (~3–4s total) | High — double the segments, double the I/O | Ultra-low latency events |
| `2` | Low (~6–8s total) | Moderate — good balance | **Most live events (default)** |
| `4` | Moderate (~10–12s total) | Lower — fewer files, less disk activity | Reliability over speed |
| `6` | Higher (~14–18s total) | Lowest | VOD-like live, very stable networks |

```bash
# Ultra-low latency: 1-second segments
ffmpeg ... -hls_time 1 -hls_list_size 10 ...

# Default: 2-second segments
ffmpeg ... -hls_time 2 -hls_list_size 10 ...

# Reliability-first: 4-second segments
ffmpeg ... -hls_time 4 -hls_list_size 8 ...
```

:::warning Shorter segments cost more
With 1-second segments, FFmpeg creates twice as many files as 2-second segments. This doubles disk I/O and increases CPU overhead. Ensure your machine can handle it — watch FFmpeg's `speed` stat (must stay ≥ `1x`).
:::

### Playlist Size (`-hls_list_size`)

Controls how many segments are listed in the `.m3u8` playlist at any time. This determines how far back a viewer can rewind during a live stream.

| Value | Rewind Window | Disk Usage |
|:-----:|:------------:|:----------:|
| `5` | 5 × segment duration | Minimal |
| `10` | 10 × segment duration | **Default** |
| `20` | 20 × segment duration | Higher |

With 2-second segments and `-hls_list_size 10`, viewers can rewind up to ~20 seconds.

**Interaction with latency:** The playlist size itself doesn't directly add latency, but it determines how much content the player knows about. A very small playlist (e.g., 3) with short segments can cause playback stalls if the player falls behind.

:::tip Rule of thumb
Keep at least 5× the `liveSyncDurationCount` (player setting) as your playlist size. With the default `liveSyncDurationCount` of 3, a playlist size of 10 gives comfortable headroom.
:::

### Encoding Preset and Tune

These FFmpeg options control encoding speed vs. quality and have a secondary effect on latency.

| Setting | What It Does | When to Use |
|---------|-------------|-------------|
| `-preset ultrafast` | Fastest encoding, largest file size | **Live streaming (recommended)** |
| `-preset fast` | Good balance of speed and file size | Live with spare CPU |
| `-preset medium` | Best quality/size ratio, slowest | VOD transcoding only |
| `-tune zerolatency` | Disables B-frames, reduces look-ahead buffer | **Live streaming (recommended)** |

**For live streaming, always use `-preset ultrafast -tune zerolatency`** unless you have significant CPU headroom. The encoding delay from a slower preset (50–200ms) is small compared to segment duration, but if encoding can't keep up with real-time, you'll drop frames.

:::info Deep Dive: What `-tune zerolatency` does
This flag tells x264 to:
- Disable B-frames (no reordering delay)
- Reduce the lookahead buffer to 0 frames
- Disable some multi-threading optimizations that add latency

The result is ~50–100ms less encoding delay at the cost of slightly larger file sizes (~10–15% increase). For live streaming, this trade-off is always worth it.
:::

### HLS Flags

Two flags are important for live streaming:

| Flag | Purpose |
|------|---------|
| `delete_segments` | Automatically deletes old `.ts` files that are no longer in the playlist. Prevents disk from filling up during long streams. |
| `append_list` | Appends new segments to the existing playlist instead of rewriting it. Required for viewers who are mid-stream to maintain continuity. |

Always use both for live streaming:

```bash
-hls_flags delete_segments+append_list
```

---

## HLS Server Settings

The HLS Media Server has several environment variables that affect live streaming performance. For the complete variable reference, see [Configuration Reference](./configuration.md).

### Content Delivery Mode

The mode you choose affects latency when segments are first requested:

| Mode | First-Request Latency | Best For |
|------|:--------------------:|----------|
| **Local** | Lowest (direct disk read) | FFmpeg runs on the same machine |
| **Proxy** | Higher (upstream fetch + cache write) | Content on a CDN or origin server |
| **Hybrid** | Local speed for local content, proxy speed for remote | Mix of local and remote events |

**For lowest latency, use local mode** — the HLS server reads segments directly from the filesystem where FFmpeg writes them. No network hop, no cache layer.

In proxy mode, the first request for each segment incurs an upstream fetch. Subsequent requests are served from the local disk cache. The inflight deduplication system ensures that even if 100 viewers request the same new segment simultaneously, only one upstream fetch occurs.

### Segment Cache Tuning (Proxy/Hybrid Mode)

These settings control how proxied segments are cached on disk:

#### `SEGMENT_CACHE_MAX_SIZE_GB`

| Value | Use Case |
|:-----:|----------|
| `10` | Few concurrent events, limited disk space |
| `50` | **Default** — handles dozens of concurrent events |
| `100`+ | Many concurrent events or long rewind windows |

**Sizing formula:**

```
Required cache ≈ concurrent_events × segments_per_event × avg_segment_size

Example: 5 events × 300 segments × 1 MB = ~1.5 GB active
```

The cache stores segments for rewind and VOD rewatch. If the cache fills up, the least-recently-used segments are evicted first — this means old rewind content disappears before current live segments.

#### `SEGMENT_CACHE_MAX_AGE_HOURS`

| Value | Use Case |
|:-----:|----------|
| `24` | Short events, save disk space |
| `72` | **Default** — 3 days of rewatch |
| `168` | Week-long rewatch availability |

Segments older than this value are automatically cleaned up during periodic maintenance, regardless of cache size.

### Revocation Polling (`REVOCATION_POLL_INTERVAL_MS`)

This controls how quickly the HLS server learns about revoked tokens and deactivated events.

| Value | Revocation Delay | API Calls/Hour | Best For |
|:-----:|:---------------:|:--------------:|----------|
| `5000` (5s) | Up to 5 seconds | 720 | High-security events |
| `15000` (15s) | Up to 15 seconds | 240 | Production |
| `30000` (30s) | Up to 30 seconds | 120 | **Default** |
| `60000` (60s) | Up to 60 seconds | 60 | Large scale, trusted audiences |

This setting does **not** affect playback latency — it only affects how quickly a revoked token stops working. Even with slow polling, the JWT's own expiry (1 hour) provides a hard upper bound.

:::tip Security-critical events
For events where immediate token revocation matters (paid content, restricted audiences), set this to `5000`–`15000`. The Platform App's `/api/revocations` endpoint is lightweight, so frequent polling is fine for single-server setups.
:::

### Session Timeout (`SESSION_TIMEOUT_SECONDS`)

Controls how long an inactive session stays "alive" before being automatically released. This affects how quickly a token can be reused on another device.

| Value | Token Reuse After Disconnect | Network Tolerance | Best For |
|:-----:|:---------------------------:|:-----------------:|----------|
| `30` | ~30 seconds | Low — brief network drops may release the session | Fast token recycling |
| `60` | ~60 seconds | Moderate | **Default** |
| `120` | ~2 minutes | High — tolerates longer network interruptions | Unstable networks, mobile viewers |

The player sends a heartbeat every 30 seconds. If the server doesn't receive a heartbeat within `SESSION_TIMEOUT_SECONDS`, the session is considered abandoned and the token becomes available for reuse.

:::warning Low timeout + unstable network
If set too low (e.g., 30s), viewers on unstable connections may get disconnected when a single heartbeat is missed. They would need to re-enter their access code. For audiences on mobile networks, consider 90–120 seconds.
:::

---

## Player Buffering (hls.js)

The video player uses [hls.js](https://github.com/video-dev/hls.js/) to handle HLS playback. Its buffering strategy is often the **largest contributor to perceived latency** — even more than segment duration.

### How the Player Decides What to Play

The player doesn't play the very latest segment. Instead, it targets a "sync point" a few segments behind the live edge. This buffer absorbs network jitter and prevents stalls.

```
Live Edge (newest segment)
   │
   │  ← liveMaxLatencyDurationCount (max allowed drift)
   │
   │  ← liveSyncDurationCount (target playback position)
   │     This is where the player aims to play
   │
   │  ← Already played content
   │
Oldest segment in playlist
```

With the default `liveSyncDurationCount` of **3** and 2-second segments, the player targets **6 seconds behind the live edge**. This is the primary source of playback latency.

### Current StreamGate Configuration

The player currently sets only two hls.js options:

```typescript
const hls = new Hls({
  enableWorker: true,       // Use Web Worker for parsing (reduces main thread load)
  lowLatencyMode: isLive,   // Enables LL-HLS optimizations for live streams
});
```

All buffer-related settings use hls.js defaults:

| Setting | Default Value | Meaning |
|---------|:------------:|---------|
| `liveSyncDurationCount` | 3 | Target 3 segments behind live edge |
| `liveMaxLatencyDurationCount` | Infinity | No maximum drift limit |
| `maxBufferLength` | 30s | Buffer up to 30 seconds ahead |
| `maxBufferSize` | 60 MB | Max buffer memory |
| `liveBackBufferLength` | Infinity | Keep all played content in buffer |

### Key Settings and Their Impact

#### `liveSyncDurationCount` — Buffer Depth

**The most impactful player setting for latency.**

| Value | Buffer Latency (2s segments) | Stall Risk | Recommendation |
|:-----:|:---------------------------:|:----------:|----------------|
| `2` | ~4 seconds | Higher — less room for jitter | Ultra-low latency, good networks |
| `3` | ~6 seconds | Moderate | **Default — balanced** |
| `4` | ~8 seconds | Lower | Reliability-first |
| `5` | ~10 seconds | Very low | Very unstable networks |

Multiply the value by your segment duration to get the buffer latency.

#### `liveMaxLatencyDurationCount` — Drift Cap

Sets the maximum number of segment durations the player can fall behind the live edge. When exceeded, the player **seeks forward** to catch up.

| Value | Behavior |
|:-----:|----------|
| `Infinity` (default) | Player never auto-seeks; it can drift arbitrarily far behind |
| `6` | With 2s segments, seeks forward if more than 12 seconds behind |
| `10` | More lenient — allows 20 seconds of drift before catching up |

**Recommendation:** Set to `liveSyncDurationCount + 3` for a good balance. This allows some drift during network hiccups but prevents the player from falling too far behind.

#### `maxBufferLength` — Forward Buffer Size

Controls how far ahead the player downloads content. Larger buffers improve resilience but use more memory and may download segments that won't be needed (if the viewer leaves).

| Value | Behavior |
|:-----:|----------|
| `10` | Minimal buffering, lower memory |
| `30` (default) | Comfortable buffer for most scenarios |
| `60` | Maximum resilience, higher memory use |

For live streaming, `30` (the default) is usually fine. Lower it only if you're targeting memory-constrained devices.

:::info Deep Dive: `lowLatencyMode` in StreamGate
The player sets `lowLatencyMode: true` for live streams. This flag activates LL-HLS (Low-Latency HLS) optimizations in hls.js — such as partial segment loading and playlist polling. However, StreamGate doesn't produce LL-HLS content (which requires `EXT-X-PART` tags and chunked transfer encoding from the server). So this flag currently has limited effect. If you implement LL-HLS at the FFmpeg/server level in the future, this flag will automatically enable client-side support.
:::

### Modifying Player Settings

These settings are defined in the player source code, not via environment variables. To change them, edit the hls.js configuration in:

```
platform/src/components/player/video-player.tsx
```

Example — tuning for lower latency:

```typescript
const hls = new Hls({
  xhrSetup: (xhr) => {
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
  },
  enableWorker: true,
  lowLatencyMode: isLive,
  // Latency tuning
  liveSyncDurationCount: 2,          // Target 2 segments behind live edge
  liveMaxLatencyDurationCount: 5,    // Seek forward if >5 segments behind
  maxBufferLength: 15,               // Buffer 15 seconds ahead
  liveBackBufferLength: 30,          // Keep 30 seconds of played content
});
```

Example — tuning for maximum reliability:

```typescript
const hls = new Hls({
  xhrSetup: (xhr) => {
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
  },
  enableWorker: true,
  lowLatencyMode: isLive,
  // Reliability tuning
  liveSyncDurationCount: 4,          // Target 4 segments behind live edge
  liveMaxLatencyDurationCount: 10,   // Tolerate up to 10 segments drift
  maxBufferLength: 60,               // Large forward buffer
});
```

:::warning Code change required
Unlike server settings (environment variables), player settings require editing source code and redeploying the Platform App. Test changes in a development environment before deploying to production.
:::

---

## Recommended Configuration Presets

Here are three tested configurations for common scenarios. Each combines FFmpeg, server, and player settings for a consistent experience.

### ⚡ Ultra-Low Latency (~3–4 seconds)

Best for: Interactive events, auctions, live Q&A where timing matters.

**FFmpeg:**

```bash
ffmpeg -i <source> \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 1 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "streams/EVENT_ID/segment-%03d.ts" \
  "streams/EVENT_ID/stream.m3u8"
```

**HLS Server (.env):**

```env
STREAM_ROOT=./streams              # Local mode for lowest latency
SESSION_TIMEOUT_SECONDS=30         # Fast token recycling
REVOCATION_POLL_INTERVAL_MS=10000  # Quick revocation
```

**Player (video-player.tsx):**

```typescript
liveSyncDurationCount: 2,
liveMaxLatencyDurationCount: 5,
maxBufferLength: 10,
liveBackBufferLength: 15,
```

**Trade-offs:**
- ✅ Lowest possible latency with standard HLS
- ⚠️ Higher CPU usage from 1-second segments
- ⚠️ More susceptible to stalls on slow networks
- ⚠️ Short session timeout may disconnect unstable mobile viewers

---

### ⚖️ Balanced (~6–8 seconds) — Default

Best for: Most live events, webinars, concerts, sports.

**FFmpeg:**

```bash
ffmpeg -i <source> \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "streams/EVENT_ID/segment-%03d.ts" \
  "streams/EVENT_ID/stream.m3u8"
```

**HLS Server (.env):**

```env
STREAM_ROOT=./streams              # Local mode
SESSION_TIMEOUT_SECONDS=60         # Default
REVOCATION_POLL_INTERVAL_MS=30000  # Default
```

**Player:** No changes needed — hls.js defaults work well for this scenario.

**Trade-offs:**
- ✅ Good balance of latency and reliability
- ✅ Works on most networks and devices
- ✅ Moderate CPU usage

---

### 🛡️ Reliability-First (~10–15 seconds)

Best for: Events with viewers on unstable networks (mobile, satellite), long-running streams where stability matters most.

**FFmpeg:**

```bash
ffmpeg -i <source> \
  -c:v libx264 -preset fast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 4 -hls_list_size 8 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "streams/EVENT_ID/segment-%03d.ts" \
  "streams/EVENT_ID/stream.m3u8"
```

**HLS Server (.env):**

```env
STREAM_ROOT=./streams              # Local mode
SESSION_TIMEOUT_SECONDS=120        # Tolerate missed heartbeats
REVOCATION_POLL_INTERVAL_MS=30000  # Default
```

**Player (video-player.tsx):**

```typescript
liveSyncDurationCount: 4,
liveMaxLatencyDurationCount: 10,
maxBufferLength: 60,
```

**Trade-offs:**
- ✅ Very resilient to network hiccups
- ✅ Lower CPU usage with 4-second segments
- ⚠️ Higher latency — not ideal for interactive content
- ⚠️ Longer session timeout means slower token recycling after disconnects

---

## File I/O and Caching Behavior

:::info Deep Dive
This section explains the technical details of how segments are stored and served. If you're an operator just tuning settings, you can safely skip this.
:::

### How Local Files Are Served

When the HLS server operates in local mode, it reads segment files directly from disk using Node.js file streams (`fs.createReadStream()`). There is **no application-level memory cache** for local files — each request triggers a filesystem read.

However, the **operating system's page cache** provides transparent caching. When a file is read from disk, the OS keeps it in RAM automatically. Subsequent reads of the same file are served from memory, not disk. For live streaming, this means:

- **"Hot" segments** (the current segment and recent ones being requested by active viewers) are almost always in the OS page cache after the first read.
- **Older segments** naturally get evicted from the page cache as new content arrives.
- You don't need to configure anything — this happens automatically.

#### When to Consider RAM-Backed Storage

For ultra-low latency scenarios with high viewer counts, you can eliminate disk I/O entirely by using a RAM-backed filesystem:

```bash
# Linux: Create a tmpfs mount for stream files
sudo mount -t tmpfs -o size=2G tmpfs /var/streams
export STREAM_ROOT=/var/streams

# macOS: Create a RAM disk
diskutil erasevolume HFS+ "StreamRAM" $(hdiutil attach -nomount ram://4194304)
export STREAM_ROOT=/Volumes/StreamRAM
```

:::warning RAM disk sizing
RAM disks use system memory. Size them for your needs:
- Per event: `hls_list_size × avg_segment_size` (e.g., 10 × 1MB = 10MB)
- Total: `concurrent_events × per_event_size` + headroom
- 512MB–2GB is usually sufficient for most setups
:::

### Proxy Mode Caching Pipeline

When the HLS server operates in proxy or hybrid mode, segments fetched from the upstream origin are cached to disk:

```
Viewer request → Cache check → Cache hit? → Serve from disk cache
                      │
                      └── Cache miss? → Fetch from upstream
                                              │
                                              ├── Write to disk cache
                                              └── Stream to viewer
```

Key behaviors:

- **Inflight deduplication:** If 50 viewers request the same new segment simultaneously, only one upstream fetch occurs. All other requests wait for that fetch to complete and then are served from cache.
- **Persistent cache:** Cached segments survive server restarts (they're on disk, not in memory).
- **LRU eviction:** When the cache exceeds `SEGMENT_CACHE_MAX_SIZE_GB`, the least-recently-used segments are evicted.
- **Age-based cleanup:** Segments older than `SEGMENT_CACHE_MAX_AGE_HOURS` are cleaned up during periodic maintenance.

### Storage Recommendations

| Scenario | Recommended Storage | Why |
|----------|-------------------|-----|
| Live streaming, local mode | SSD | Fast writes from FFmpeg, fast reads for serving |
| Live streaming, ultra-low latency | tmpfs (RAM disk) | Eliminates disk I/O entirely |
| Proxy mode cache | SSD | Fast cache writes and reads |
| VOD / rewatch content | HDD acceptable | Sequential reads, latency less critical |
| Development / testing | Any | Performance not critical |

---

## Monitoring and Verifying Latency

### Measuring End-to-End Latency

The simplest way to measure actual latency:

1. Point the camera at a clock or timer (or use a test pattern with a timestamp overlay: `testsrc2` includes one)
2. Open the stream in the player on another device
3. Compare the time shown on the camera feed with the time displayed on the player
4. The difference is your glass-to-glass latency

### Checking FFmpeg Health

While FFmpeg is running, monitor its output:

```
frame= 1200 fps= 30 q=28.0 size= 12345kB time=00:00:40.00 speed=1x
```

- **`speed` must be ≥ `1x`** — if it drops below `1x`, FFmpeg can't keep up and will drop frames
- **`fps` should match your source** — e.g., 30 fps for a 30 fps source
- **`q` (quantization)** — lower values mean better quality; if this spikes, encoding is struggling

### Checking Segment Generation

Verify that new segments are appearing at the expected rate:

```bash
# Watch for new files (should appear every hls_time seconds)
watch -n 1 'ls -lt streams/EVENT_ID/ | head -5'

# Count segments in the playlist
grep -c '.ts' streams/EVENT_ID/stream.m3u8
```

### Browser DevTools

For advanced debugging, check the player's buffer health in the browser:

1. Open **DevTools** → **Console**
2. The hls.js instance exposes buffer stats that can be inspected
3. Look at the **Network** tab to see segment download timing — each `.ts` request should complete well within the segment duration

:::tip Quick latency check
If segments are 2 seconds long and downloading each one takes more than 1.5 seconds, the viewer's network is too slow for that segment size. Consider longer segments or lower bitrates for those audiences.
:::

---

## Quick Reference

### Setting Relationships

```
Segment Duration (-hls_time)    ──affects──▶  Player buffer latency
                                ──affects──▶  Disk I/O frequency
                                ──affects──▶  CPU overhead

liveSyncDurationCount           ──affects──▶  Seconds behind live edge
                                              (= value × segment duration)

Playlist Size (-hls_list_size)  ──affects──▶  Rewind window
                                              (= value × segment duration)

Content Mode (local/proxy)      ──affects──▶  First-segment delivery time

Session Timeout                 ──affects──▶  Token reuse speed
                                ──affects──▶  Network interruption tolerance
```

### Minimum Latency Achievable

| Configuration | Approximate Latency |
|--------------|:------------------:|
| 1s segments + `liveSyncDurationCount: 2` | **~3 seconds** |
| 2s segments + `liveSyncDurationCount: 2` | **~5 seconds** |
| 2s segments + `liveSyncDurationCount: 3` (default) | **~7 seconds** |
| 4s segments + `liveSyncDurationCount: 3` | **~13 seconds** |
| 4s segments + `liveSyncDurationCount: 4` | **~17 seconds** |

These are approximate values. Actual latency depends on network conditions, encoding speed, and system load.

---

## Further Reading

- [Live Streaming with FFmpeg](./streaming-with-ffmpeg.md) — Complete FFmpeg setup guide, RTMP ingest, ABR, and VOD conversion
- [Configuration Reference](./configuration.md) — All environment variables with defaults and descriptions
- [Admin Console](./admin-console.md) — Creating events, managing tokens, monitoring sessions
- [Troubleshooting](./troubleshooting.md) — Common issues and solutions
- [hls.js Configuration](https://github.com/video-dev/hls.js/blob/master/docs/API.md#fine-tuning) — Full list of hls.js tuning options
