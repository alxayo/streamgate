#!/usr/bin/env bash
# ============================================================================
# VOD Transcoder — FFmpeg-based HLS transcoding for StreamGate
# ============================================================================
# This script runs inside a Container Apps Job. It:
#   1. Downloads the source video from Azure Blob Storage
#   2. Runs FFmpeg to produce multi-rendition HLS segments (fMP4)
#   3. Uploads the output HLS files to Azure Blob Storage
#   4. Reports progress and completion back to the Platform App
#
# Environment Variables (set by the Platform App launcher):
#   JOB_ID                           — Unique ID matching the TranscodeJob DB record
#   EVENT_ID                         — Event this upload belongs to
#   CODEC                            — Codec to use (h264, av1, vp8, vp9)
#   SOURCE_BLOB_URL                  — Blob path to the source video file
#   OUTPUT_BLOB_PREFIX               — Blob path prefix for HLS output
#   RENDITIONS                       — JSON array of rendition configs
#   HLS_TIME                         — HLS segment duration in seconds
#   FORCE_KEYFRAME_INTERVAL          — Keyframe interval in seconds
#   CALLBACK_URL                     — URL to POST completion status
#   PROGRESS_URL                     — URL to POST progress updates
#   AZURE_STORAGE_CONNECTION_STRING  — For blob storage access
#   INTERNAL_API_KEY                 — For authenticating callbacks
# ============================================================================
set -euo pipefail

echo "============================================"
echo "StreamGate VOD Transcoder"
echo "============================================"
echo "Job ID:     ${JOB_ID:-unknown}"
echo "Event ID:   ${EVENT_ID:-unknown}"
echo "Codec:      ${CODEC:-unknown}"
echo "Source:     ${SOURCE_BLOB_URL:-unknown}"
echo "Output:     ${OUTPUT_BLOB_PREFIX:-unknown}"
echo "HLS Time:   ${HLS_TIME:-4}"
echo "Keyframe:   ${FORCE_KEYFRAME_INTERVAL:-4}"
echo "============================================"

# ---------- Configuration ----------

# Blob container names
SOURCE_CONTAINER="vod-uploads"
OUTPUT_CONTAINER="hls-content"

# Local working directories
WORK_DIR="/tmp/transcode"
SOURCE_DIR="${WORK_DIR}/source"
OUTPUT_DIR="${WORK_DIR}/output"

# Create working directories
mkdir -p "$SOURCE_DIR" "$OUTPUT_DIR"

# Parse the connection string to get account name and key
# Format: DefaultEndpointsProtocol=https;AccountName=xxx;AccountKey=xxx;EndpointSuffix=core.windows.net
# Note: We use sed instead of grep -P because Alpine/BusyBox grep
# doesn't support Perl regex (-P flag).
parse_connection_string() {
  local conn_str="$1"
  STORAGE_ACCOUNT_NAME=$(echo "$conn_str" | sed -n 's/.*AccountName=\([^;]*\).*/\1/p')
  STORAGE_ACCOUNT_KEY=$(echo "$conn_str" | sed -n 's/.*AccountKey=\([^;]*\).*/\1/p')
  export STORAGE_ACCOUNT_NAME STORAGE_ACCOUNT_KEY
}

# ---------- Helper Functions ----------

# Report progress to the Platform App (0-100)
# Payload must match TranscodeProgressPayload: { jobId, codec, progress }
report_progress() {
  local progress="$1"
  local message="${2:-}"
  echo "[progress] ${progress}% — ${message}"
  
  if [ -n "${PROGRESS_URL:-}" ]; then
    curl -s -X POST "${PROGRESS_URL}" \
      -H "Content-Type: application/json" \
      -H "X-Internal-Api-Key: ${INTERNAL_API_KEY:-}" \
      -d "{\"jobId\": \"${JOB_ID}\", \"codec\": \"${CODEC}\", \"progress\": ${progress}}" \
      --max-time 10 || echo "[warn] Failed to report progress"
  fi
}

# Report completion (success or failure) to the Platform App
# Payload must match TranscodeCallbackPayload: { jobId, codec, status: 'completed'|'failed', error? }
report_completion() {
  local status="$1"    # "completed" or "failed" (lowercase!)
  local message="${2:-}"
  echo "[callback] Status: ${status} — ${message}"
  
  if [ -n "${CALLBACK_URL:-}" ]; then
    curl -s -X POST "${CALLBACK_URL}" \
      -H "Content-Type: application/json" \
      -H "X-Internal-Api-Key: ${INTERNAL_API_KEY:-}" \
      -d "{\"jobId\": \"${JOB_ID}\", \"codec\": \"${CODEC}\", \"status\": \"${status}\", \"error\": \"${message}\"}" \
      --max-time 30 || echo "[warn] Failed to report completion"
  fi
}

# Upload a file to Azure Blob Storage
upload_blob() {
  local local_path="$1"
  local container="$2"
  local blob_path="$3"
  
  az storage blob upload \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$STORAGE_ACCOUNT_KEY" \
    --container-name "$container" \
    --name "$blob_path" \
    --file "$local_path" \
    --overwrite true \
    --no-progress \
    --only-show-errors 2>&1
}

# Download a file from Azure Blob Storage
download_blob() {
  local container="$1"
  local blob_path="$2"
  local local_path="$3"
  
  az storage blob download \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$STORAGE_ACCOUNT_KEY" \
    --container-name "$container" \
    --name "$blob_path" \
    --file "$local_path" \
    --no-progress \
    --only-show-errors 2>&1
}

# ---------- Main Transcoding Flow ----------

# Trap errors — report failure on any unhandled exit
trap 'report_completion "failed" "Transcoder crashed with exit code $?"' ERR

# Step 1: Parse connection string
echo ""
echo "[step 1/5] Parsing Azure Storage credentials..."
if [ -z "${AZURE_STORAGE_CONNECTION_STRING:-}" ]; then
  echo "[error] AZURE_STORAGE_CONNECTION_STRING not set"
  report_completion "failed" "Missing Azure Storage connection string"
  exit 1
fi
parse_connection_string "$AZURE_STORAGE_CONNECTION_STRING"
echo "  Storage account: ${STORAGE_ACCOUNT_NAME}"

# Step 2: Download source video from blob storage
echo ""
echo "[step 2/5] Downloading source video..."
report_progress 5 "Downloading source video"

# SOURCE_BLOB_URL is the blob name in the vod-uploads container.
# Format: "{eventId}/{filename}" (e.g., "abc-123/video.mp4")
# No prefix stripping needed — the platform stores just the blob name.
SOURCE_BLOB_NAME="${SOURCE_BLOB_URL}"
SOURCE_FILENAME=$(basename "$SOURCE_BLOB_URL")
SOURCE_PATH="${SOURCE_DIR}/${SOURCE_FILENAME}"

echo "  Container: ${SOURCE_CONTAINER}"
echo "  Blob:      ${SOURCE_BLOB_NAME}"
echo "  Local:     ${SOURCE_PATH}"

download_blob "$SOURCE_CONTAINER" "$SOURCE_BLOB_NAME" "$SOURCE_PATH"
SOURCE_SIZE=$(stat -c %s "$SOURCE_PATH" 2>/dev/null || stat -f %z "$SOURCE_PATH" 2>/dev/null)
echo "  Downloaded: ${SOURCE_SIZE} bytes"
report_progress 10 "Source downloaded (${SOURCE_SIZE} bytes)"

# Step 3: Build FFmpeg command based on codec and renditions
echo ""
echo "[step 3/5] Building FFmpeg command for codec: ${CODEC}"
report_progress 15 "Starting transcoding"

# Parse renditions JSON — extract label, width, height, bitrate for each
# Example RENDITIONS: [{"label":"1080p","width":1920,"height":1080,"videoBitrate":"5000k","audioBitrate":"192k"}]
HLS_TIME="${HLS_TIME:-4}"
KEYFRAME_INTERVAL="${FORCE_KEYFRAME_INTERVAL:-4}"

# Create the output directory for this codec
CODEC_OUTPUT_DIR="${OUTPUT_DIR}/${CODEC}"
mkdir -p "$CODEC_OUTPUT_DIR"

# Build FFmpeg arguments dynamically based on codec and renditions
build_ffmpeg_command() {
  local codec="$1"
  local renditions_json="$2"
  
  # Common input args
  local cmd="-i ${SOURCE_PATH} -hide_banner -y"
  
  # Count renditions
  local num_renditions
  num_renditions=$(echo "$renditions_json" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
  
  # Add codec-specific encoding settings for each rendition
  for i in $(seq 0 $((num_renditions - 1))); do
    local label width height vbitrate abitrate
    label=$(echo "$renditions_json" | python3 -c "import sys,json; r=json.load(sys.stdin)[$i]; print(r['label'])")
    width=$(echo "$renditions_json" | python3 -c "import sys,json; r=json.load(sys.stdin)[$i]; print(r['width'])")
    height=$(echo "$renditions_json" | python3 -c "import sys,json; r=json.load(sys.stdin)[$i]; print(r['height'])")
    vbitrate=$(echo "$renditions_json" | python3 -c "import sys,json; r=json.load(sys.stdin)[$i]; print(r['videoBitrate'])")
    abitrate=$(echo "$renditions_json" | python3 -c "import sys,json; r=json.load(sys.stdin)[$i]; print(r.get('audioBitrate', '128k'))")
    
    # Video encoding args per codec
    case "$codec" in
      h264)
        cmd="$cmd -map 0:v:0 -map 0:a:0?"
        cmd="$cmd -c:v:${i} libx264 -preset medium -profile:v:${i} high -level:v:${i} 4.1"
        cmd="$cmd -b:v:${i} ${vbitrate} -maxrate:v:${i} ${vbitrate} -bufsize:v:${i} $((${vbitrate%k} * 2))k"
        cmd="$cmd -s:v:${i} ${width}x${height}"
        cmd="$cmd -c:a:${i} aac -b:a:${i} ${abitrate} -ac 2"
        ;;
      av1)
        cmd="$cmd -map 0:v:0 -map 0:a:0?"
        cmd="$cmd -c:v:${i} libsvtav1 -preset 6 -crf 30"
        cmd="$cmd -b:v:${i} ${vbitrate} -maxrate:v:${i} ${vbitrate}"
        cmd="$cmd -s:v:${i} ${width}x${height}"
        cmd="$cmd -c:a:${i} libopus -b:a:${i} ${abitrate}"
        ;;
      vp9)
        cmd="$cmd -map 0:v:0 -map 0:a:0?"
        cmd="$cmd -c:v:${i} libvpx-vp9 -quality good -speed 2 -row-mt 1"
        cmd="$cmd -b:v:${i} ${vbitrate} -maxrate:v:${i} ${vbitrate}"
        cmd="$cmd -s:v:${i} ${width}x${height}"
        cmd="$cmd -c:a:${i} libopus -b:a:${i} ${abitrate}"
        ;;
      vp8)
        cmd="$cmd -map 0:v:0 -map 0:a:0?"
        cmd="$cmd -c:v:${i} libvpx -quality good -speed 2"
        cmd="$cmd -b:v:${i} ${vbitrate} -maxrate:v:${i} ${vbitrate}"
        cmd="$cmd -s:v:${i} ${width}x${height}"
        cmd="$cmd -c:a:${i} libopus -b:a:${i} ${abitrate}"
        ;;
    esac
    
    echo "$label" >> "${CODEC_OUTPUT_DIR}/renditions.txt"
  done
  
  # Force keyframes at regular intervals for clean HLS segment splits
  cmd="$cmd -force_key_frames expr:gte(t,n_forced*${KEYFRAME_INTERVAL})"
  
  # HLS muxer settings — produce fMP4 segments with a master playlist
  cmd="$cmd -f hls"
  cmd="$cmd -hls_time ${HLS_TIME}"
  cmd="$cmd -hls_playlist_type vod"
  cmd="$cmd -hls_flags independent_segments"
  cmd="$cmd -hls_segment_type fmp4"
  cmd="$cmd -hls_segment_filename ${CODEC_OUTPUT_DIR}/stream_%v/segment_%04d.m4s"
  cmd="$cmd -master_pl_name master.m3u8"
  
  # Variant stream mapping — one per rendition
  local var_map=""
  for i in $(seq 0 $((num_renditions - 1))); do
    if [ -n "$var_map" ]; then
      var_map="${var_map} "
    fi
    var_map="${var_map}v:${i},a:${i}"
  done
  cmd="$cmd -var_stream_map \"${var_map}\""
  
  # Output path pattern — each rendition gets its own subdirectory
  cmd="$cmd ${CODEC_OUTPUT_DIR}/stream_%v/playlist.m3u8"
  
  echo "$cmd"
}

FFMPEG_ARGS=$(build_ffmpeg_command "$CODEC" "$RENDITIONS")
echo "  FFmpeg command: ffmpeg ${FFMPEG_ARGS}"

# Pre-create per-rendition output directories.
# FFmpeg's HLS muxer with the stream_%v pattern requires subdirectories
# (stream_0/, stream_1/, stream_2/, etc.) to exist BEFORE it starts writing.
# Without this, FFmpeg exits immediately with code 2 ("No such file or directory").
num_renditions=$(echo "$RENDITIONS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")
for i in $(seq 0 $((num_renditions - 1))); do
  mkdir -p "${CODEC_OUTPUT_DIR}/stream_${i}"
done
echo "  Created ${num_renditions} output directories"

# Step 4: Run FFmpeg with progress monitoring
echo ""
echo "[step 4/5] Running FFmpeg transcoding..."

# Get source duration for progress calculation
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SOURCE_PATH" 2>/dev/null | head -1)
DURATION_INT=${DURATION%.*}
echo "  Source duration: ${DURATION_INT}s"

# Run FFmpeg — use progress pipe to report percentage
# The eval is needed because FFMPEG_ARGS contains quoted var_stream_map
eval ffmpeg ${FFMPEG_ARGS} -progress pipe:1 2>"${WORK_DIR}/ffmpeg_stderr.log" | \
  while IFS='=' read -r key value; do
    if [ "$key" = "out_time_ms" ] && [ -n "$value" ] && [ "$value" != "N/A" ]; then
      # out_time_ms is in microseconds
      current_seconds=$((value / 1000000))
      if [ "$DURATION_INT" -gt 0 ]; then
        # Map FFmpeg progress (0-100%) to our progress range (15-85%)
        raw_pct=$((current_seconds * 100 / DURATION_INT))
        if [ "$raw_pct" -gt 100 ]; then raw_pct=100; fi
        # Scale to 15-85 range (15% for download, 85% for upload start)
        mapped_pct=$((15 + raw_pct * 70 / 100))
        report_progress "$mapped_pct" "Transcoding: ${current_seconds}s / ${DURATION_INT}s"
      fi
    fi
  done

# Check FFmpeg exit status
FFMPEG_EXIT=${PIPESTATUS[0]}
if [ "$FFMPEG_EXIT" -ne 0 ]; then
  echo "[error] FFmpeg failed with exit code ${FFMPEG_EXIT}"
  echo "[error] FFmpeg stderr output:"
  cat "${WORK_DIR}/ffmpeg_stderr.log" >&2
  # Also echo to stdout so it shows in container logs
  cat "${WORK_DIR}/ffmpeg_stderr.log"
  report_completion "failed" "FFmpeg exited with code ${FFMPEG_EXIT}"
  exit 1
fi

echo "  Transcoding complete!"
report_progress 85 "Transcoding complete, uploading output"

# Step 5: Upload HLS output to blob storage
echo ""
echo "[step 5/5] Uploading HLS segments to blob storage..."

# Count total files to upload for progress tracking
TOTAL_FILES=$(find "$CODEC_OUTPUT_DIR" -type f | wc -l)
UPLOADED=0

echo "  Output container: ${OUTPUT_CONTAINER}"
echo "  Output prefix:    ${OUTPUT_BLOB_PREFIX}"
echo "  Files to upload:  ${TOTAL_FILES}"

# Upload all files recursively — maintain directory structure
find "$CODEC_OUTPUT_DIR" -type f | while read -r local_file; do
  # Get the path relative to the codec output directory
  relative_path="${local_file#${CODEC_OUTPUT_DIR}/}"
  blob_path="${OUTPUT_BLOB_PREFIX}${relative_path}"
  
  upload_blob "$local_file" "$OUTPUT_CONTAINER" "$blob_path"
  
  UPLOADED=$((UPLOADED + 1))
  upload_pct=$((85 + UPLOADED * 15 / TOTAL_FILES))
  # Report every 10 files to avoid flooding
  if [ $((UPLOADED % 10)) -eq 0 ] || [ "$UPLOADED" -eq "$TOTAL_FILES" ]; then
    report_progress "$upload_pct" "Uploading: ${UPLOADED}/${TOTAL_FILES} files"
  fi
done

echo ""
echo "============================================"
echo "Transcoding complete!"
echo "  Codec:      ${CODEC}"
echo "  Renditions: $(cat "${CODEC_OUTPUT_DIR}/renditions.txt" | tr '\n' ', ')"
echo "  Output:     ${OUTPUT_CONTAINER}/${OUTPUT_BLOB_PREFIX}"
echo "============================================"

# Report success
report_progress 100 "Complete"
report_completion "completed" "Transcoding finished successfully"

# Clean up temp files
rm -rf "$WORK_DIR"
echo "[done] Transcoder exiting."
