#!/usr/bin/env bash
# start-demo.sh
#
# Bootstraps a StreamGate demo in one shot:
#   • installs npm dependencies
#   • generates a .env file with random secrets (admin password: admin123)
#   • runs Prisma migrations and generates the Prisma client
#   • creates a VOD event with one access ticket
#   • writes minimal demo HLS stream files
#   • starts the Platform App (port 3000) and HLS Media Server (port 4000)
#   • prints connection info and the demo ticket code
#
# Requirements: Node.js 20+
# Usage:  chmod +x start-demo.sh && ./start-demo.sh

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m';  BOLD='\033[1m';    RESET='\033[0m'

info()    { printf "${BLUE}  →${RESET}  %s\n"      "$*"; }
ok()      { printf "${GREEN}  ✓${RESET}  %s\n"     "$*"; }
warn()    { printf "${YELLOW}  ⚠${RESET}  %s\n"    "$*"; }
fail()    { printf "${YELLOW}  ✗${RESET}  %s\n" "$*" >&2; }
banner()  { printf "\n${BOLD}${CYAN}%s${RESET}\n\n" "$*"; }

# ── cleanup ───────────────────────────────────────────────────────────────────
PLATFORM_PID=""
HLS_PID=""

cleanup() {
  printf "\n${BLUE}  →${RESET}  Stopping services…\n"
  [[ -n "$PLATFORM_PID" ]] && kill "$PLATFORM_PID" 2>/dev/null || true
  [[ -n "$HLS_PID"      ]] && kill "$HLS_PID"      2>/dev/null || true
}
trap cleanup EXIT INT TERM

# ── banner ────────────────────────────────────────────────────────────────────
printf "\n${BOLD}${CYAN}"
printf "  ╔══════════════════════════════════════════════╗\n"
printf "  ║       StreamGate  —  Demo Setup              ║\n"
printf "  ╚══════════════════════════════════════════════╝"
printf "${RESET}\n\n"

# ── 1. Node.js check ──────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi
NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR="${NODE_VER%%.*}"
if (( NODE_MAJOR < 20 )); then
  fail "Node.js 20+ required. Found v${NODE_VER}. Please upgrade from https://nodejs.org"
  exit 1
fi
ok "Node.js v${NODE_VER}"

# ── 2. Install dependencies ───────────────────────────────────────────────────
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  info "Installing npm dependencies (this may take a minute)…"
  npm install --prefix "$SCRIPT_DIR" --silent
  ok "Dependencies installed"
else
  ok "Dependencies already installed"
fi

# ── 3. Create .env ────────────────────────────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/.env"
ADMIN_PASSWORD_DISPLAY="(existing configured password in .env)"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Generating .env with random secrets…"

  SIGNING_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")
  INTERNAL_KEY=$(node   -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")
  # Pre-computed bcrypt hash for admin password "admin123" (cost factor 12).
  # Run  npm run hash-password  to create your own.
  ADMIN_HASH='$2b$12$FBT2ZzLHnZ3rCSRzF9//XuRAXKj8tcflq6GtS50m1lcGza.ZPptEG'
  STREAMS_PATH="$SCRIPT_DIR/streams"

  cat > "$ENV_FILE" << EOF
# === Shared ===
PLAYBACK_SIGNING_SECRET=${SIGNING_SECRET}
INTERNAL_API_KEY=${INTERNAL_KEY}

# === Platform App ===
DATABASE_URL=file:./dev.db
ADMIN_PASSWORD_HASH='${ADMIN_HASH}'
HLS_SERVER_BASE_URL=http://localhost:4000
NEXT_PUBLIC_APP_NAME=StreamGate
SESSION_TIMEOUT_SECONDS=60

# === HLS Media Server ===
PLATFORM_APP_URL=http://localhost:3000
STREAM_ROOT=${STREAMS_PATH}
UPSTREAM_ORIGIN=
SEGMENT_CACHE_ROOT=
SEGMENT_CACHE_MAX_SIZE_GB=50
SEGMENT_CACHE_MAX_AGE_HOURS=72
REVOCATION_POLL_INTERVAL_MS=30000
CORS_ALLOWED_ORIGIN=http://localhost:3000
PORT=4000
EOF
  ok ".env created  (admin password: admin123)"
  ADMIN_PASSWORD_DISPLAY="admin123"
else
  ok ".env already exists"
fi

# Source .env so all child processes inherit the env vars.
# set -a exports every variable that is assigned.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ── 4. Database ───────────────────────────────────────────────────────────────
# Prisma CLI resolves file:./dev.db relative to the platform/ working directory,
# so the actual DB lives at platform/dev.db, NOT platform/prisma/dev.db.
DB_FILE="$SCRIPT_DIR/platform/dev.db"
GENERATED_DIR="$SCRIPT_DIR/platform/src/generated/prisma"

if [[ ! -f "$DB_FILE" ]]; then
  info "Running database migrations…"
  (cd "$SCRIPT_DIR/platform" && npx prisma migrate deploy 2>&1 | grep -v '^[[:space:]]*$' || true)
  ok "Database initialised"
else
  ok "Database already exists"
fi

if [[ ! -d "$GENERATED_DIR" ]]; then
  info "Generating Prisma client…"
  (cd "$SCRIPT_DIR/platform" && npx prisma generate 2>&1 | grep -v '^[[:space:]]*$' || true)
  ok "Prisma client generated"
fi

# ── 5. Create VOD event + ticket ──────────────────────────────────────────────
info "Creating demo VOD event and access ticket…"
VOD_EXIT=0
VOD_OUT=$(
  cd "$SCRIPT_DIR"
  npx tsx scripts/add-vod.ts \
    --title="Demo VOD Stream" \
    --description="Sample HLS VOD — swap the files in streams/ with real content to enable playback" \
    --access-window-hours=168 2>&1
) || VOD_EXIT=$?

# grep exits 1 when no match; suppress that so set -e doesn't fire
EVENT_ID=$(printf '%s\n'   "$VOD_OUT" | grep -E "^Event ID:"   | awk '{print $NF}' || true)
TOKEN_CODE=$(printf '%s\n' "$VOD_OUT" | grep -E "^Token code:" | awk '{print $NF}' || true)

if [[ $VOD_EXIT -ne 0 || -z "$EVENT_ID" || -z "$TOKEN_CODE" ]]; then
  fail "Failed to create VOD event. Script output:"
  printf '%s\n' "$VOD_OUT" >&2
  exit 1
fi
ok "VOD event created  (ID: ${EVENT_ID})"

# ── 6. Write demo HLS stream files ────────────────────────────────────────────
STREAM_DIR="$SCRIPT_DIR/streams/$EVENT_ID"
if [[ ! -f "$STREAM_DIR/stream.m3u8" ]]; then
  info "Writing demo HLS stream files…"
  mkdir -p "$STREAM_DIR"

  # Minimal HLS playlist
  cat > "$STREAM_DIR/stream.m3u8" << 'PLAYLIST'
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:2.0,
segment-000.ts
#EXTINF:2.0,
segment-001.ts
#EXTINF:2.0,
segment-002.ts
#EXTINF:2.0,
segment-003.ts
#EXT-X-ENDLIST
PLAYLIST

  # Write 20 null MPEG-TS packets (3760 bytes) per segment so the HLS
  # server has real files to serve, proving the auth flow end-to-end.
  # Replace these files with actual video segments for real playback.
  node -e "
    const fs = require('fs');
    const pkt = Buffer.alloc(188, 0xFF);
    pkt[0] = 0x47; pkt[1] = 0x1f; pkt[2] = 0xff; pkt[3] = 0x10;
    const seg = Buffer.concat(Array(20).fill(pkt));
    const dir = process.argv[1];
    for (let i = 0; i < 4; i++) {
      fs.writeFileSync(dir + '/segment-00' + i + '.ts', seg);
    }
  " -- "$STREAM_DIR"

  ok "Demo HLS files written  (replace with real video for actual playback)"
else
  ok "HLS stream files already exist"
fi

# ── 7. Start services ─────────────────────────────────────────────────────────
PLATFORM_LOG="/tmp/streamgate-platform.log"
HLS_LOG="/tmp/streamgate-hls.log"

info "Starting Platform App on port 3000…"
(cd "$SCRIPT_DIR/platform" && PORT=3000 npm run dev > "$PLATFORM_LOG" 2>&1) &
PLATFORM_PID=$!

info "Starting HLS Media Server on port 4000…"
(cd "$SCRIPT_DIR/hls-server" && npm run dev > "$HLS_LOG" 2>&1) &
HLS_PID=$!

# ── 8. Wait for readiness ─────────────────────────────────────────────────────
info "Waiting for services to be ready (up to 90 s)…"
READY=false
for i in $(seq 1 90); do
  sleep 1
  P_OK=false; H_OK=false
  curl -sf http://localhost:3000       -o /dev/null 2>/dev/null && P_OK=true || true
  curl -sf http://localhost:4000/health -o /dev/null 2>/dev/null && H_OK=true || true
  if $P_OK && $H_OK; then READY=true; break; fi
done

$READY || warn "Services may still be starting — check logs if something looks wrong."

# ── 9. Connection info ────────────────────────────────────────────────────────
printf "\n${BOLD}${GREEN}"
printf "  ╔══════════════════════════════════════════════════════════════╗\n"
printf "  ║            StreamGate is Running!                            ║\n"
printf "  ╚══════════════════════════════════════════════════════════════╝"
printf "${RESET}\n\n"

printf "  ${BOLD}Viewer Portal${RESET}    http://localhost:3000\n"
printf "  ${BOLD}Admin Console${RESET}    http://localhost:3000/admin\n"
printf "  ${BOLD}HLS Server${RESET}       http://localhost:4000\n"
printf "  ${BOLD}HLS Health${RESET}       http://localhost:4000/health\n"

printf "\n"
printf "  ${BOLD}${YELLOW}┌──────────────────────────────────────────────────────┐${RESET}\n"
printf "  ${BOLD}${YELLOW}│  DEMO ACCESS TICKET                                  │${RESET}\n"
printf "  ${BOLD}${YELLOW}│                                                      │${RESET}\n"
printf "  ${BOLD}${YELLOW}│  Token Code :  ${CYAN}%-12s${YELLOW}                          │${RESET}\n" "$TOKEN_CODE"
printf "  ${BOLD}${YELLOW}│  Event ID   :  ${CYAN}%-36s${YELLOW}  │${RESET}\n"               "$EVENT_ID"
printf "  ${BOLD}${YELLOW}│  Expires    :  7 days from now                       │${RESET}\n"
printf "  ${BOLD}${YELLOW}└──────────────────────────────────────────────────────┘${RESET}\n"

printf "\n"
printf "  ${BOLD}Admin login${RESET}\n"
printf "    URL       http://localhost:3000/admin\n"
printf "    Password  %s\n" "$ADMIN_PASSWORD_DISPLAY"

printf "\n"
printf "  ${BOLD}How to watch${RESET}\n"
printf "    1. Open   ${CYAN}http://localhost:3000${RESET}  in your browser\n"
printf "    2. Enter  ${BOLD}${CYAN}%s${RESET}  as the token code\n" "$TOKEN_CODE"
printf "    3. Click  'Start Watching'\n"

printf "\n"
printf "  ${BOLD}Real video${RESET}\n"
printf "    Copy your HLS files to:\n"
printf "      ${CYAN}%s/${RESET}\n" "$STREAM_DIR"
printf "    Required files:  stream.m3u8  segment-000.ts  segment-001.ts  …\n"

printf "\n"
printf "  ${BOLD}Service logs${RESET}\n"
printf "    Platform   %s\n" "$PLATFORM_LOG"
printf "    HLS        %s\n" "$HLS_LOG"

printf "\n  ${YELLOW}Press Ctrl+C to stop all services.${RESET}\n\n"

# ── 10. Block until services exit or user presses Ctrl+C ─────────────────────
wait
