# ============================================================================
# VOD Transcoder Docker Image for StreamGate
# ============================================================================
# Multi-codec FFmpeg transcoder that runs as an Azure Container Apps Job.
# Supports H.264, AV1, VP9, and VP8 — the same image handles all codecs,
# selected via the CODEC environment variable at runtime.
#
# Included tools:
#   - FFmpeg 7.x (with libx264, libsvtav1, libvpx/vp9, libopus, aac)
#   - Azure CLI (for blob storage upload/download)
#   - Python 3 (for JSON parsing in the entrypoint script)
#   - curl (for HTTP callbacks to the Platform App)
#
# Size: ~300 MB (Alpine base + FFmpeg + Azure CLI)
# ============================================================================

FROM alpine:3.21

# Install FFmpeg with all codec libraries, plus Azure CLI and utilities
RUN apk add --no-cache \
    # FFmpeg with broad codec support (x264, x265, svtav1, vpx, opus, aac)
    ffmpeg \
    # Azure CLI — used to upload/download blobs from Azure Storage
    # (lighter than azcopy and available in Alpine repos)
    py3-pip \
    python3 \
    # curl for HTTP callbacks to the Platform App
    curl \
    # bash for the entrypoint script
    bash \
    # coreutils for stat command used in the script
    coreutils \
    && pip3 install --break-system-packages azure-cli \
    && az version \
    && ffmpeg -version | head -1

# Copy the transcoder entrypoint script
COPY transcode.sh /usr/local/bin/transcode.sh
RUN chmod +x /usr/local/bin/transcode.sh

# The container runs the transcoding script and exits when done.
# All configuration is passed via environment variables (set by the
# Platform App's transcoder-launcher when starting a job execution).
ENTRYPOINT ["/usr/local/bin/transcode.sh"]
