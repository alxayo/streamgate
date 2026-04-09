---
sidebar_position: 6
title: Live Streaming with FFmpeg
---

# Live Streaming with FFmpeg

StreamGate doesn't include a built-in transcoder — it serves HLS content that you generate. **FFmpeg** is the recommended tool for converting live video (RTMP, camera feeds) or existing files (MP4) into HLS format that StreamGate can deliver.

## How It Works

```
Video Source → FFmpeg → HLS Files (.m3u8 + .ts) → HLS Media Server → Viewers
              (transcodes)  (written to disk)       (serves via JWT auth)
```

FFmpeg takes a video input (live RTMP stream, webcam, test pattern, or MP4 file) and outputs HLS-formatted files: a `.m3u8` playlist (manifest) and `.ts` segment files. The HLS Media Server reads these files and delivers them to authenticated viewers.

## Prerequisites

Verify FFmpeg is installed:

```bash
ffmpeg -version
```

If not installed, see [Prerequisites](./installation/prerequisites.md) for installation instructions.

## Stream Directory Structure

The HLS server expects stream files organized by event ID:

```
hls-server/streams/          # STREAM_ROOT (manual setup)
  └── <event-id>/            # UUID from the admin console
      ├── stream.m3u8        # HLS playlist manifest
      ├── segment-000.ts     # Video segments
      ├── segment-001.ts
      ├── segment-002.ts
      └── ...
```

:::warning Docker users
When using Docker Compose, place files in `./streams/` (project root) instead of `./hls-server/streams/`. The Docker volume maps `./streams` → `/streams` inside the container.
:::

Create the directory before starting FFmpeg:

```bash
# Replace EVENT_ID with your event's UUID
mkdir -p hls-server/streams/EVENT_ID
```

## Test Pattern (No Camera Needed)

Generate a test stream with a built-in video pattern and tone — great for verifying your setup:

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

This generates a 720p stream with:
- A moving test pattern with timestamp overlay
- A 440 Hz sine wave audio tone
- 2-second HLS segments
- Rolling window of the last 10 segments

## RTMP Ingest

### Recommended: rtmp-go Integration & Automation Scripts

For robust, production-ready ingest, use [rtmp-go](https://github.com/alxayo/rtmp-go) as your RTMP endpoint. This is the recommended approach for both Docker and local workflows. See [Docker Setup: Integrating rtmp-go](./installation/docker-setup.md#integrating-rtmp-go-for-rtmp-ingest-step-by-step) for a full walkthrough.

- **Start rtmp-go** (see [rtmp-go docs](https://github.com/alxayo/rtmp-go) for install/run instructions):
  ```bash
  rtmp-go -listen :1935
  ```
- Point your streaming software (e.g., OBS) to `rtmp://localhost:1935/live/stream`.
- Use the provided automation scripts to set up events and start streaming:
  - **`npm run rtmp-ingest`** — All-in-one: creates an event, generates tokens, sets up the stream directory, and launches FFmpeg to ingest from rtmp-go. Supports `--docker` flag for Docker environments.
  - **`npm run create-event`** — Creates an ad hoc event with tokens and stream directory. Prompts for metadata if not provided via CLI args. Use this when you want to set up the event first and run FFmpeg separately.
  - **`npm run add-vod`** — Creates a VOD event with a token and stream folder for pre-recorded HLS content.
- For Docker, always use the `./streams/` directory at the project root (see [Docker Setup](./installation/docker-setup.md#stream-directory)).

#### FFmpeg Example (RTMP to HLS)

```bash
ffmpeg -i rtmp://localhost:1935/live/stream \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "streams/YOUR_EVENT_ID/segment-%03d.ts" \
  "streams/YOUR_EVENT_ID/stream.m3u8"
```

See [Docker Setup](./installation/docker-setup.md#integrating-rtmp-go-for-rtmp-ingest-step-by-step) for a complete, automated ingest workflow.

### Receiving RTMP from OBS, Wirecast, or Other Software (Manual)

You can also run FFmpeg as an RTMP listener directly (not recommended for production):

```bash
ffmpeg -listen 1 -i rtmp://0.0.0.0:1935/live/stream \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "hls-server/streams/EVENT_ID/segment-%03d.ts" \
  "hls-server/streams/EVENT_ID/stream.m3u8"
```

Then configure your streaming software:

**OBS Studio:**
1. Go to **Settings → Stream**
2. Service: **Custom**
3. Server: `rtmp://localhost:1935/live`
4. Stream Key: `stream`
5. Click **Start Streaming**

**Wirecast / vMix / Other:**
- RTMP URL: `rtmp://localhost:1935/live/stream`

:::tip Firewall
If FFmpeg and your streaming software are on different machines, replace `localhost` with the FFmpeg machine's IP address and ensure port 1935 is open.
:::

### Receiving from an RTMP Server (e.g., nginx-rtmp)

If you have an existing RTMP server, pull the stream from it:

```bash
ffmpeg -i rtmp://your-rtmp-server:1935/live/stream \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "hls-server/streams/EVENT_ID/segment-%03d.ts" \
  "hls-server/streams/EVENT_ID/stream.m3u8"
```

## Multi-Bitrate Adaptive Streaming

Adaptive bitrate (ABR) lets the player switch quality based on the viewer's bandwidth. FFmpeg can generate multiple renditions simultaneously:

```bash
ffmpeg -listen 1 -i rtmp://0.0.0.0:1935/live/stream \
  -filter_complex "[0:v]split=3[v1][v2][v3]; \
    [v1]scale=1920:1080[v1out]; \
    [v2]scale=1280:720[v2out]; \
    [v3]scale=854:480[v3out]" \
  \
  -map "[v1out]" -map 0:a -c:v libx264 -preset fast -b:v 4500k -c:a aac -b:a 192k \
    -f hls -hls_time 4 -hls_list_size 10 \
    -hls_flags delete_segments+append_list \
    -hls_segment_filename "hls-server/streams/EVENT_ID/1080p_%03d.ts" \
    "hls-server/streams/EVENT_ID/1080p.m3u8" \
  \
  -map "[v2out]" -map 0:a -c:v libx264 -preset fast -b:v 2500k -c:a aac -b:a 128k \
    -f hls -hls_time 4 -hls_list_size 10 \
    -hls_flags delete_segments+append_list \
    -hls_segment_filename "hls-server/streams/EVENT_ID/720p_%03d.ts" \
    "hls-server/streams/EVENT_ID/720p.m3u8" \
  \
  -map "[v3out]" -map 0:a -c:v libx264 -preset fast -b:v 1200k -c:a aac -b:a 96k \
    -f hls -hls_time 4 -hls_list_size 10 \
    -hls_flags delete_segments+append_list \
    -hls_segment_filename "hls-server/streams/EVENT_ID/480p_%03d.ts" \
    "hls-server/streams/EVENT_ID/480p.m3u8"
```

Then create a **master playlist** (`stream.m3u8`) that references all renditions:

```bash
cat > hls-server/streams/EVENT_ID/stream.m3u8 << 'EOF'
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=4700000,RESOLUTION=1920x1080
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2600000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1300000,RESOLUTION=854x480
480p.m3u8
EOF
```

:::info CPU usage
Multi-bitrate encoding requires significantly more CPU. On a typical quad-core machine, encoding 3 renditions uses approximately 60–80% CPU. Consider using a dedicated encoding machine for production.
:::

## VOD: Converting MP4 Files to HLS

Convert an existing video file into HLS format for on-demand viewing:

```bash
ffmpeg -i input-video.mp4 \
  -c:v libx264 -preset medium -crf 23 \
  -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_list_size 0 \
  -hls_playlist_type vod \
  -hls_segment_filename "hls-server/streams/EVENT_ID/segment-%03d.ts" \
  "hls-server/streams/EVENT_ID/stream.m3u8"
```

Key differences from live streaming:
- `-hls_list_size 0` — Keep all segments in the playlist (not a rolling window)
- `-hls_playlist_type vod` — Marks the playlist as VOD (enables full seek)
- `-preset medium -crf 23` — Better quality/size ratio (not optimized for speed like live)
- No `-re` flag — Transcode as fast as possible

## FFmpeg Options Reference

### HLS Output Options

| Option | Live Value | VOD Value | Description |
|--------|-----------|-----------|-------------|
| `-f hls` | — | — | Output format: HLS |
| `-hls_time` | `2` | `6` | Segment duration in seconds. Lower = less latency, more files |
| `-hls_list_size` | `10` | `0` | Max segments in playlist. `10` = rolling window, `0` = keep all |
| `-hls_flags delete_segments` | ✅ | ❌ | Delete old segments to save disk space |
| `-hls_flags append_list` | ✅ | ❌ | Append to existing playlist instead of overwriting |
| `-hls_playlist_type vod` | ❌ | ✅ | Mark playlist as complete (enables full seek) |
| `-hls_segment_filename` | — | — | Pattern for segment filenames |

### Video Encoding Options

| Option | Description |
|--------|-------------|
| `-c:v libx264` | H.264 video codec (universally supported) |
| `-preset ultrafast` | Fastest encoding, largest files (best for live) |
| `-preset medium` | Balanced quality/speed (best for VOD) |
| `-tune zerolatency` | Minimize encoding latency (live only) |
| `-crf 23` | Constant quality factor (18 = high, 23 = medium, 28 = low) |
| `-b:v 2500k` | Target video bitrate |
| `-re` | Read input at native frame rate (required for test patterns) |

### Audio Encoding Options

| Option | Description |
|--------|-------------|
| `-c:a aac` | AAC audio codec |
| `-b:a 128k` | Audio bitrate (96k–192k typical) |

## Monitoring FFmpeg

### Reading FFmpeg Output

While running, FFmpeg displays real-time statistics:

```
frame= 1200 fps= 30 q=28.0 size=   12345kB time=00:00:40.00 bitrate=2530.5kbits/s speed=1x
```

| Field | Meaning |
|-------|---------|
| `frame` | Total frames encoded |
| `fps` | Current encoding speed (should match source fps for live) |
| `q` | Quantization parameter (lower = better quality) |
| `size` | Total output size so far |
| `time` | Elapsed output time |
| `bitrate` | Current output bitrate |
| `speed` | `1x` = real-time (live), `>1x` = faster than real-time (VOD) |

:::warning Speed below 1x
If `speed` drops below `1x` during live streaming, FFmpeg can't keep up — frames will be dropped. Try:
- A faster preset (`-preset ultrafast`)
- Lower resolution
- Hardware acceleration (`-c:v h264_nvenc` for NVIDIA, `-c:v h264_videotoolbox` for macOS)
:::

### Verifying Segments

Check that segments are being generated:

```bash
# Watch the stream directory for new files
ls -la hls-server/streams/EVENT_ID/

# On Windows
dir hls-server\streams\EVENT_ID\

# Check the manifest
cat hls-server/streams/EVENT_ID/stream.m3u8
```

You should see new `.ts` files appearing every few seconds (matching your `-hls_time` value).

## Using Upstream Proxy Mode

Instead of writing HLS files locally, you can configure the HLS server to proxy content from an upstream origin (e.g., a CDN, cloud storage, or another HLS server):

1. Set the `UPSTREAM_ORIGIN` environment variable:
   ```env
   UPSTREAM_ORIGIN=https://your-cdn.example.com/hls
   ```

2. The HLS server will fetch content from `https://your-cdn.example.com/hls/<eventId>/stream.m3u8`

3. Fetched segments are cached locally at `SEGMENT_CACHE_ROOT` for rewind/rewatch

In **hybrid mode** (both `STREAM_ROOT` and `UPSTREAM_ORIGIN` set), the HLS server checks for local files first and falls back to the upstream origin.

See [Configuration Reference](./configuration.md) for details on content source modes.

## Troubleshooting FFmpeg & Automated Ingest

| Problem | Cause | Solution |
|---------|-------|----------|
| "No such file or directory" | Stream directory doesn't exist | Create it: `mkdir -p hls-server/streams/EVENT_ID` or `mkdir -p streams/EVENT_ID` for Docker |
| No `.ts` files appearing | FFmpeg not writing to correct path | Double-check the event ID and path (see [Docker Setup](./installation/docker-setup.md#stream-directory)) |
| `speed` below 1x | CPU can't keep up | Use `-preset ultrafast` or lower resolution |
| "Address already in use" (RTMP) | Port 1935 is taken | Kill the other process or use a different port |
| "Connection refused" (RTMP pull) | Source server not running | Verify the RTMP URL and server status |
| Segments appear but player shows nothing | Manifest path mismatch | Ensure the main playlist is named `stream.m3u8` |
| Automated ingest script fails | Database or path issue | See [Docker Setup: Troubleshooting & Common Pitfalls](./installation/docker-setup.md#troubleshooting--common-pitfalls) and [General Troubleshooting](./troubleshooting.md) |
| rtmp-go not receiving streams | Port/firewall or config | Ensure port 1935 is open and matches FFmpeg/OBS settings |
| Token errors on playback | JWT/token mismatch | Verify token is for the correct event and not expired/revoked |

For more, see [General Troubleshooting](./troubleshooting.md) and [Docker Setup: Troubleshooting](./installation/docker-setup.md#troubleshooting--common-pitfalls).
