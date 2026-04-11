#!/usr/bin/env bash
# rtmp-ingest.sh — Start RTMP-to-HLS ingest for a given event ID
# Usage: ./rtmp-ingest.sh <event-id> [rtmp-port] [rtmp-path]
#
# Examples:
#   ./rtmp-ingest.sh 57cb6636-dbfd-4e9d-8c38-48a97b33149a
#   ./rtmp-ingest.sh 57cb6636-dbfd-4e9d-8c38-48a97b33149a 1935 /live/stream

set -euo pipefail

EVENT_ID="${1:-}"
RTMP_PORT="${2:-1935}"
RTMP_PATH="${3:-/live/stream}"

if [ -z "$EVENT_ID" ]; then
  echo "Usage: $0 <event-id> [rtmp-port] [rtmp-path]"
  echo ""
  echo "  event-id    UUID of the event (required)"
  echo "  rtmp-port   RTMP listen port (default: 1935)"
  echo "  rtmp-path   RTMP stream path (default: /live/stream)"
  exit 1
fi

# Resolve streams directory relative to this script's location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STREAMS_ROOT="$SCRIPT_DIR/../streams"
STREAM_DIR="$STREAMS_ROOT/$EVENT_ID"

# Create output directory
mkdir -p "$STREAM_DIR"

SEGMENT_PATTERN="$STREAM_DIR/segment-%03d.ts"
HLS_MANIFEST="$STREAM_DIR/stream.m3u8"
RTMP_URL="rtmp://0.0.0.0:${RTMP_PORT}${RTMP_PATH}"

echo ""
echo "RTMP-to-HLS Ingest"
echo "========================================"
echo "  Event ID:   $EVENT_ID"
echo "  RTMP URL:   $RTMP_URL"
echo "  Stream dir: $STREAM_DIR"
echo "  Manifest:   $HLS_MANIFEST"
echo ""
echo "  Waiting for RTMP connection on port $RTMP_PORT..."
echo "  Send your stream to: rtmp://<this-machine-ip>:${RTMP_PORT}${RTMP_PATH}"
echo ""

ffmpeg -fflags nobuffer -flags low_delay -analyzeduration 500000 -probesize 500000 \
  -listen 1 -i "$RTMP_URL" \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -x264-params "keyint=30:min-keyint=30:scenecut=0" \
  -c:a aac -b:a 128k \
  -f hls -hls_time 1 -hls_list_size 6 \
  -hls_flags delete_segments+append_list+split_by_time \
  -hls_segment_filename "$SEGMENT_PATTERN" \
  "$HLS_MANIFEST"
