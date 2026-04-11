# start-demo.ps1
#
# Bootstraps a StreamGate demo in one shot:
#   * installs npm dependencies
#   * generates a .env file with random secrets (admin password: admin123)
#   * runs Prisma migrations and generates the Prisma client
#   * creates a VOD event with one access ticket
#   * writes minimal demo HLS stream files
#   * starts the Platform App (port 3000) and HLS Media Server (port 4000)
#   * prints connection info and the demo ticket code
#
# Requirements: Node.js 20+, PowerShell 5.1+
# Usage:  .\start-demo.ps1
#   If blocked by execution policy, run first:
#     Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

# ── helper output functions ───────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "  -> $msg" -ForegroundColor Cyan }
function Write-OK    { param($msg) Write-Host "  v  $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "  !  $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  x  $msg" -ForegroundColor Red }

# ── cleanup ───────────────────────────────────────────────────────────────────
$PlatformProc = $null
$HlsProc      = $null

function Stop-Services {
    Write-Host "`n  -> Stopping services..." -ForegroundColor Cyan
    if ($null -ne $PlatformProc -and -not $PlatformProc.HasExited) {
        Stop-Process -Id $PlatformProc.Id -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $HlsProc -and -not $HlsProc.HasExited) {
        Stop-Process -Id $HlsProc.Id -Force -ErrorAction SilentlyContinue
    }
}

# ── banner ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  +----------------------------------------------+" -ForegroundColor Cyan
Write-Host "  |       StreamGate  -  Demo Setup              |" -ForegroundColor Cyan
Write-Host "  +----------------------------------------------+" -ForegroundColor Cyan
Write-Host ""

try {

# ── 1. Node.js check ──────────────────────────────────────────────────────────
$nodeVer = & node --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Node.js not found. Install Node.js 20+ from https://nodejs.org"
    exit 1
}
$nodeMajor = [int]($nodeVer.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
    Write-Fail "Node.js 20+ required. Found $nodeVer. Please upgrade from https://nodejs.org"
    exit 1
}
Write-OK "Node.js $nodeVer"

# ── Detect LAN IPv4 address ────────────────────────────────────────────────────
$LanIp = ""
try {
    # Get the first non-loopback IPv4 address
    $LanIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias * -ErrorAction Stop |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -First 1).IPAddress
} catch {
    # Fallback for older PowerShell / non-Windows
    try {
        $LanIp = ([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.ToString() -ne '127.0.0.1' } |
            Select-Object -First 1).ToString()
    } catch {}
}
if ($LanIp) {
    Write-OK "LAN IP detected: $LanIp"
} else {
    Write-Warn "Could not detect LAN IPv4 address - only localhost URLs will be shown"
}

# ── 2. Install dependencies ───────────────────────────────────────────────────
if (-not (Test-Path "$ProjectRoot\node_modules")) {
    Write-Step "Installing npm dependencies (this may take a minute)..."
    Push-Location $ProjectRoot
    npm install --silent
    Pop-Location
    Write-OK "Dependencies installed"
} else {
    Write-OK "Dependencies already installed"
}

# ── 3. Create .env ────────────────────────────────────────────────────────────
$EnvFile = "$ProjectRoot\.env"
$AdminPasswordDisplay = "(existing configured password in .env)"
if (-not (Test-Path $EnvFile)) {
    Write-Step "Generating .env with random secrets..."

    $signingSecret = & node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
    $internalKey   = & node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))"
    # Pre-computed bcrypt hash for admin password "admin123" (cost factor 12).
    # Run  npm run hash-password  to create your own.
    $adminHash   = '$2b$12$FBT2ZzLHnZ3rCSRzF9//XuRAXKj8tcflq6GtS50m1lcGza.ZPptEG'
    # Use forward slashes so Node.js resolves the path on all platforms.
    $streamsPath = "$ProjectRoot\streams".Replace('\', '/')

$corsOrigin = "http://localhost:3000"
if ($LanIp) { $corsOrigin = "http://localhost:3000,http://${LanIp}:3000" }

    @"
# === Shared ===
PLAYBACK_SIGNING_SECRET=$signingSecret
INTERNAL_API_KEY=$internalKey

# === Platform App ===
DATABASE_URL=file:./dev.db
ADMIN_PASSWORD_HASH='$adminHash'
HLS_SERVER_BASE_URL=http://localhost:4000
NEXT_PUBLIC_APP_NAME=StreamGate
SESSION_TIMEOUT_SECONDS=60

# === HLS Media Server ===
PLATFORM_APP_URL=http://localhost:3000
STREAM_ROOT=$streamsPath
UPSTREAM_ORIGIN=
SEGMENT_CACHE_ROOT=
SEGMENT_CACHE_MAX_SIZE_GB=50
SEGMENT_CACHE_MAX_AGE_HOURS=72
REVOCATION_POLL_INTERVAL_MS=30000
CORS_ALLOWED_ORIGIN=$corsOrigin
PORT=4000
"@ | Set-Content $EnvFile -Encoding UTF8

    Write-OK ".env created  (admin password: admin123)"
    $AdminPasswordDisplay = "admin123"
} else {
    Write-OK ".env already exists"
}

# Load .env into the current process so all child processes inherit the vars.
Get-Content $EnvFile | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object {
    $idx = $_.IndexOf('=')
    if ($idx -gt 0) {
        $key = $_.Substring(0, $idx).Trim()
        $val = $_.Substring($idx + 1).Trim()
        [System.Environment]::SetEnvironmentVariable($key, $val, 'Process')
    }
}

# ── 4. Database ───────────────────────────────────────────────────────────────
$DbFile       = "$ProjectRoot\platform\dev.db"
$GeneratedDir = "$ProjectRoot\platform\src\generated\prisma"

if (-not (Test-Path $DbFile)) {
    Write-Step "Running database migrations..."
    Push-Location "$ProjectRoot\platform"
    npx prisma migrate deploy 2>&1 | Where-Object { $_ -ne "" } | ForEach-Object { Write-Host "     $_" }
    Pop-Location
    Write-OK "Database initialised"
} else {
    Write-OK "Database already exists"
}

if (-not (Test-Path $GeneratedDir)) {
    Write-Step "Generating Prisma client..."
    Push-Location "$ProjectRoot\platform"
    npx prisma generate 2>&1 | Where-Object { $_ -ne "" } | ForEach-Object { Write-Host "     $_" }
    Pop-Location
    Write-OK "Prisma client generated"
}

# ── 5. Create VOD event + ticket ──────────────────────────────────────────────
Write-Step "Creating demo VOD event and access ticket..."
Push-Location $ProjectRoot
$vodOutput = npx tsx scripts/add-vod.ts `
    --title="Demo VOD Stream" `
    "--description=Sample HLS VOD - swap the files in streams/ with real content to enable playback" `
    --access-window-hours=168 2>&1
Pop-Location

$eventIdLine   = $vodOutput | Where-Object { $_ -match "^Event ID:" }   | Select-Object -First 1
$tokenCodeLine = $vodOutput | Where-Object { $_ -match "^Token code:" } | Select-Object -First 1
$eventId   = if ($eventIdLine)   { ($eventIdLine   -split '\s+')[-1] } else { "" }
$tokenCode = if ($tokenCodeLine) { ($tokenCodeLine -split '\s+')[-1] } else { "" }

if (-not $eventId -or -not $tokenCode) {
    Write-Fail "Failed to create VOD event. Script output:"
    $vodOutput | ForEach-Object { Write-Host "  $_" }
    exit 1
}
Write-OK "VOD event created  (ID: $eventId)"

# ── 6. Write demo HLS stream files ────────────────────────────────────────────
$StreamDir = "$ProjectRoot\streams\$eventId"
if (-not (Test-Path "$StreamDir\stream.m3u8")) {
    Write-Step "Writing demo HLS stream files..."
    New-Item -ItemType Directory -Path $StreamDir -Force | Out-Null

    # Minimal HLS playlist (ASCII line endings for broadest hls.js compat)
    $playlist = "#EXTM3U`r`n#EXT-X-VERSION:3`r`n#EXT-X-TARGETDURATION:2`r`n" +
                "#EXT-X-MEDIA-SEQUENCE:0`r`n" +
                "#EXTINF:2.0,`r`nsegment-000.ts`r`n" +
                "#EXTINF:2.0,`r`nsegment-001.ts`r`n" +
                "#EXTINF:2.0,`r`nsegment-002.ts`r`n" +
                "#EXTINF:2.0,`r`nsegment-003.ts`r`n" +
                "#EXT-X-ENDLIST`r`n"
    [System.IO.File]::WriteAllText("$StreamDir\stream.m3u8", $playlist, [System.Text.Encoding]::ASCII)

    # Write 20 null MPEG-TS packets (3760 bytes) per segment so the HLS
    # server has real files to serve, proving the auth flow end-to-end.
    # Replace these files with actual video segments for real playback.
    $pkt = [byte[]]::new(188)
    $pkt[0] = 0x47; $pkt[1] = 0x1f; $pkt[2] = 0xff; $pkt[3] = 0x10
    for ($j = 4; $j -lt 188; $j++) { $pkt[$j] = 0xFF }
    $seg = [byte[]]::new(188 * 20)
    for ($k = 0; $k -lt 20; $k++) {
        [Array]::Copy($pkt, 0, $seg, $k * 188, 188)
    }
    for ($i = 0; $i -lt 4; $i++) {
        [System.IO.File]::WriteAllBytes("$StreamDir\segment-00$i.ts", $seg)
    }

    Write-OK "Demo HLS files written  (replace with real video for actual playback)"
} else {
    Write-OK "HLS stream files already exist"
}

# ── 7. Start services ─────────────────────────────────────────────────────────
$PlatformLog = "$env:TEMP\streamgate-platform.log"
$HlsLog      = "$env:TEMP\streamgate-hls.log"

# Locate the npm wrapper so Start-Process can find it on Windows.
$npmPath = (Get-Command npm -ErrorAction Stop).Source

Write-Step "Starting Platform App on port 3000 (binding to 0.0.0.0)..."
$env:PORT = "3000"
$PlatformProc = Start-Process -FilePath $npmPath `
    -ArgumentList @("run", "dev", "--", "--hostname", "0.0.0.0") `
    -WorkingDirectory "$ProjectRoot\platform" `
    -NoNewWindow -PassThru `
    -RedirectStandardOutput  $PlatformLog `
    -RedirectStandardError  "$env:TEMP\streamgate-platform-err.log"

Write-Step "Starting HLS Media Server on port 4000..."
$env:PORT = "4000"
$HlsProc = Start-Process -FilePath $npmPath `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory "$ProjectRoot\hls-server" `
    -NoNewWindow -PassThru `
    -RedirectStandardOutput  $HlsLog `
    -RedirectStandardError  "$env:TEMP\streamgate-hls-err.log"

# ── 8. Wait for readiness ─────────────────────────────────────────────────────
Write-Step "Waiting for services to be ready (up to 90 s)..."
$ready = $false
for ($attempt = 1; $attempt -le 90; $attempt++) {
    Start-Sleep -Seconds 1
    $pOk = $false; $hOk = $false
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000"       -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -lt 500) { $pOk = $true }
    } catch {}
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:4000/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -lt 500) { $hOk = $true }
    } catch {}
    if ($pOk -and $hOk) { $ready = $true; break }
}
if (-not $ready) { Write-Warn "Services may still be starting. Check logs if something looks wrong." }

# ── 9. Connection info ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Green
Write-Host "  |            StreamGate is Running!                            |" -ForegroundColor Green
Write-Host "  +--------------------------------------------------------------+" -ForegroundColor Green
Write-Host ""

Write-Host "  Viewer Portal    " -NoNewline; Write-Host "http://localhost:3000"        -ForegroundColor Cyan
Write-Host "  Admin Console    " -NoNewline; Write-Host "http://localhost:3000/admin"  -ForegroundColor Cyan
Write-Host "  HLS Server       " -NoNewline; Write-Host "http://localhost:4000"        -ForegroundColor Cyan
Write-Host "  HLS Health       " -NoNewline; Write-Host "http://localhost:4000/health" -ForegroundColor Cyan
if ($LanIp) {
    Write-Host ""
    Write-Host "  LAN Access"
    Write-Host "    Viewer Portal  " -NoNewline; Write-Host "http://${LanIp}:3000"       -ForegroundColor Cyan
    Write-Host "    Admin Console  " -NoNewline; Write-Host "http://${LanIp}:3000/admin" -ForegroundColor Cyan
    Write-Host "    HLS Server     " -NoNewline; Write-Host "http://${LanIp}:4000"       -ForegroundColor Cyan
}

Write-Host ""
Write-Host "  +------------------------------------------------------+" -ForegroundColor Yellow
Write-Host "  |  DEMO ACCESS TICKET                                  |" -ForegroundColor Yellow
Write-Host "  |                                                      |" -ForegroundColor Yellow
Write-Host "  |  Token Code :  " -ForegroundColor Yellow -NoNewline
Write-Host ("{0,-12}" -f $tokenCode) -ForegroundColor Cyan -NoNewline
Write-Host "                          |" -ForegroundColor Yellow
Write-Host "  |  Event ID   :  " -ForegroundColor Yellow -NoNewline
Write-Host ("{0,-36}" -f $eventId) -ForegroundColor Cyan -NoNewline
Write-Host "  |" -ForegroundColor Yellow
Write-Host "  |  Expires    :  7 days from now                       |" -ForegroundColor Yellow
Write-Host "  +------------------------------------------------------+" -ForegroundColor Yellow

Write-Host ""
Write-Host "  Admin Login"
Write-Host "    URL       http://localhost:3000/admin"
Write-Host "    Password  $AdminPasswordDisplay"

Write-Host ""
Write-Host "  How to Watch"
Write-Host "    1. Open   " -NoNewline; Write-Host "http://localhost:3000" -ForegroundColor Cyan -NoNewline; Write-Host "  in your browser"
if ($LanIp) {
    Write-Host "           or " -NoNewline; Write-Host "http://${LanIp}:3000" -ForegroundColor Cyan -NoNewline; Write-Host "  from another device on your network"
}
Write-Host "    2. Enter  " -NoNewline; Write-Host $tokenCode -ForegroundColor Cyan -NoNewline; Write-Host "  as the token code"
Write-Host "    3. Click  'Start Watching'"

Write-Host ""
Write-Host "  Real Video"
Write-Host "    Copy your HLS files to:"
Write-Host "      " -NoNewline; Write-Host $StreamDir -ForegroundColor Cyan
Write-Host "    Required:  stream.m3u8  segment-000.ts  segment-001.ts  ..."

Write-Host ""
Write-Host "  Service Logs"
Write-Host "    Platform   $PlatformLog"
Write-Host "    HLS        $HlsLog"

Write-Host ""
Write-Host "  Press Ctrl+C to stop all services." -ForegroundColor Yellow
Write-Host ""

# ── 10. Block until services exit or user presses Ctrl+C ─────────────────────
while ($true) {
    Start-Sleep -Seconds 2
    # Exit automatically if either service has crashed
    if ($PlatformProc.HasExited -or $HlsProc.HasExited) {
        Write-Warn "A service has stopped unexpectedly. Check the logs above."
        break
    }
}

} finally {
    Stop-Services
}
