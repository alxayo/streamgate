# StreamGate Azure Deployment

Deploy StreamGate (ticket-gated HLS streaming platform) into the **same Azure Container Apps environment** as the rtmp-go RTMP server. StreamGate adds a viewer portal with ticket-based access control on top of the HLS streams produced by rtmp-go's transcoder.

## Architecture

```
                    ┌──────────────────────────────────────────────────────┐
                    │  Azure Container Apps Environment (rg-rtmpgo)        │
                    │                                                      │
  RTMP Publisher    │  ┌──────────────┐      ┌──────────────────┐         │
  (OBS / FFmpeg) ──────▶ rtmp-server  │──────▶ hls-transcoder   │         │
                    │  │ TCP :1935    │ hook │ FFmpeg ABR        │         │
                    │  └──────────────┘      │ 1080p/720p/480p  │         │
                    │                        └────────┬─────────┘         │
                    │                            writes│                  │
                    │                                 ▼                   │
                    │   ┌──────────────┐     ┌────────────────┐           │
                    │   │ blob-sidecar │◀────│  Azure Files   │           │
                    │   │ syncs to blob│     │  hls-output    │           │
                    │   └──────┬───────┘     └───────┬────────┘           │
                    │          │                     │ mount (RW)         │
                    │          ▼                     ▼                    │
                    │  ┌───────────────┐    ┌────────────────────┐        │
                    │  │ Blob Storage  │◀───│ streamgate-hls     │        │
                    │  │ hls-content   │fall│ Express :4000      │        │
                    │  │ /hls/live_*   │back│ JWT validation     │        │
                    │  └───────────────┘    │ local → cache →    │        │
   Viewer ─────────────────────────────▶    │   upstream proxy   │        │
   (Browser)        │                       └──────────────────┬─┘        │
   ticket code ─────────────────────▶ ┌────────────────────────┘         │
                    │                 │           ▲ polls                 │
                    │                 │           │ /api/revocations      │
                    │                 │  ┌────────┴───────────┐           │
                    │                 └──▶ streamgate-platform│           │
                    │                    │ Next.js :3000      │           │
                    │                    │ Viewer portal      │           │
                    │                    │ Admin console      │           │
                    │                    │ JWT issuance       │           │
                    │                    └────────────────────┘           │
                    └──────────────────────────────────────────────────────┘
```

**Shared resources** (from rtmp-go): ACR, Storage Account, Managed Identity, VNet, Log Analytics

**StreamGate-specific resources**: 2 Container Apps, 2 Azure Files shares, 3 storage mounts

### HLS Content Delivery Chain

The HLS server resolves content through a three-tier fallback:

1. **Local mount** — Azure Files `hls-output` share mounted at `/hls-output`
2. **Segment cache** — Cached segments from previous upstream fetches at `/segment-cache`
3. **Upstream proxy** — Blob Storage at `https://<storage>.blob.core.windows.net/hls-content/hls/`

> **Important**: The blob sidecar (from rtmp-go) uploads HLS content to `hls-content/hls/live_{eventId}/`. The `UPSTREAM_ORIGIN` env var must include the `/hls` path prefix to match this structure.

> **Azure Files SMB caching**: Container Apps mount Azure Files via SMB (CIFS), which aggressively caches directory listings. Newly written files may not appear on the mounted filesystem for several minutes. The upstream proxy to Blob Storage mitigates this — blob storage reflects writes immediately. For live streams, the upstream proxy is the primary content source.

### ABR Manifest Structure

The HLS transcoder produces adaptive bitrate output:

```
live_{eventId}/
├── master.m3u8           # ABR master playlist (references sub-streams)
├── stream_0/index.m3u8   # 1080p variant
├── stream_0/seg_00001.ts
├── stream_1/index.m3u8   # 720p variant
├── stream_1/seg_00001.ts
├── stream_2/index.m3u8   # 480p variant
└── stream_2/seg_00001.ts
```

The master manifest is `master.m3u8` (not `stream.m3u8`). The platform's stream probe, token validation, and admin preview all reference this filename.

### SQLite on Azure Files

SQLite requires POSIX file locking which Azure Files (SMB) does not fully support. The platform's `docker-entrypoint.sh` works around this by:

1. Copying the database from the persistent mount (`/data/streamgate.db`) to local disk (`/tmp/streamgate.db`)
2. Running Prisma migrations and the Next.js server against the local copy
3. Syncing the local copy back to the mount every 60 seconds and on container exit

This means there is up to 60 seconds of data loss if the container crashes without a clean shutdown. For production, migrate to PostgreSQL.

## Prerequisites

- **rtmp-go deployed** — `cd ../rtmp-go/azure && ./deploy.sh` must have completed successfully
- **Azure CLI** — logged in (`az login`)
- **Node.js 20+** — for generating the admin password hash

## Quick Start

```bash
# 1. Generate admin password hash
cd ../platform && npm install && npm run hash-password
# Enter your desired admin password, copy the hash output

# 2. Deploy StreamGate
cd ../azure
ADMIN_PASSWORD_HASH='$2b$12$your_hash_here' ./deploy.sh

# 3. (Optional) Set up custom domains
PLATFORM_APP_FQDN="<from deploy output>" \
HLS_SERVER_FQDN="<from deploy output>" \
./dns-deploy.sh
```

## Secrets

The deploy script auto-generates `PLAYBACK_SIGNING_SECRET` and `INTERNAL_API_KEY` if not provided. **Save them** — they're printed during deployment and needed for redeployment.

| Secret | Purpose | Generation |
|--------|---------|------------|
| `PLAYBACK_SIGNING_SECRET` | HMAC-SHA256 for JWT tokens (shared between platform and HLS server) | `openssl rand -hex 32` |
| `INTERNAL_API_KEY` | Authenticates revocation sync between HLS → Platform | `openssl rand -base64 24` |
| `ADMIN_PASSWORD_HASH` | Bcrypt hash of the admin password | `npm run hash-password` |

## RTMP Auth Token

rtmp-go uses a **single shared auth token** for all streams under the `live/` app prefix. This token was configured during rtmp-go deployment. Every broadcaster uses it regardless of which event UUID they publish to.

**Broadcaster publishes to:**
```
rtmp://stream.port-80.com/live/{EVENT_UUID}?token=<rtmp-shared-token>
```

The `{EVENT_UUID}` is the event ID from StreamGate's admin console. The `<rtmp-shared-token>` is the secret portion of the RTMP auth token (the value after `=` in the `-auth-token live/stream=secret` flag).

> **Path mapping**: rtmp-go's HLS transcoder sanitizes stream keys by replacing `/` with `_`, so `live/{uuid}` produces output at `/hls-output/live_{uuid}/`. StreamGate's HLS server uses `STREAM_KEY_PREFIX=live_` to bridge this convention gap transparently.

## Admin Workflow

1. **Log in** to the admin console at `https://<platform-fqdn>/admin`
2. **Create an event** — set title, schedule, stream type (LIVE). Note the **event UUID** displayed
3. **Tell the broadcaster** to publish to:
   ```
   rtmp://stream.port-80.com/live/{EVENT_UUID}?token=<rtmp-shared-token>
   ```
   Or with ffmpeg:
   ```bash
   ffmpeg -re -i video.mp4 -c copy -f flv \
     "rtmp://stream.port-80.com/live/{EVENT_UUID}?token=<rtmp-shared-token>"
   ```
4. **Generate tickets** in the admin console for the event
5. **Distribute ticket codes** to viewers (12-character alphanumeric codes)
6. **Viewers** visit `https://<platform-fqdn>` → enter ticket code → watch the multi-bitrate HLS stream

## DNS Setup

After the main deployment, optionally set up custom domains:

```bash
PLATFORM_APP_FQDN="sg-platform-xxx.eastus2.azurecontainerapps.io" \
HLS_SERVER_FQDN="sg-hls-xxx.eastus2.azurecontainerapps.io" \
./dns-deploy.sh
```

This creates:
- `watch.port-80.com` → Platform App
- `hls.port-80.com` → HLS Server

After DNS propagates, redeploy with the custom domain URLs:

```bash
HLS_SERVER_BASE_URL="https://hls.port-80.com" \
CORS_ALLOWED_ORIGIN="https://watch.port-80.com" \
ADMIN_PASSWORD_HASH='$2b$12$...' \
PLAYBACK_SIGNING_SECRET="..." \
INTERNAL_API_KEY="..." \
./deploy.sh
```

## Environment Variables

### deploy.sh

| Variable | Default | Description |
|----------|---------|-------------|
| `RESOURCE_GROUP` | `rg-rtmpgo` | Azure resource group (must contain rtmp-go deployment) |
| `LOCATION` | `eastus2` | Azure region |
| `PLAYBACK_SIGNING_SECRET` | (auto-generated) | HMAC secret for JWT playback tokens |
| `INTERNAL_API_KEY` | (auto-generated) | API key for internal revocation sync |
| `ADMIN_PASSWORD_HASH` | (required) | Bcrypt hash of admin password |
| `HLS_SERVER_BASE_URL` | (auto: ACA FQDN) | Public URL of HLS server (override after DNS setup) |
| `CORS_ALLOWED_ORIGIN` | (auto: ACA FQDN) | CORS origin for HLS server |
| `ADMIN_ALLOWED_IP` | (auto-detected) | IP address allowed to access `/admin`. Auto-detected via ifconfig.me if empty. Set to empty string to disable restriction. |

### dns-deploy.sh

| Variable | Default | Description |
|----------|---------|-------------|
| `PLATFORM_APP_FQDN` | (required) | Platform App FQDN from deploy output |
| `HLS_SERVER_FQDN` | (required) | HLS Server FQDN from deploy output |
| `DNS_RESOURCE_GROUP` | `rg-dns` | Resource group containing the DNS zone |
| `DNS_ZONE_NAME` | `port-80.com` | Domain name |

## Tear Down

### Remove StreamGate only (preserves rtmp-go)

```bash
./destroy.sh          # interactive — type 'streamgate' to confirm
./destroy.sh --yes    # non-interactive
```

This selectively removes:
- 2 Container Apps (streamgate-platform, streamgate-hls)
- 3 storage mounts from the Container Apps Environment
- 2 Azure Files shares (streamgate-data, segment-cache)
- 2 ACR images

**rtmp-go resources are unaffected.**

### Remove DNS records only

```bash
./dns-destroy.sh          # interactive
./dns-destroy.sh --yes    # non-interactive
```

Removes only the `watch` and `hls` CNAME records. The DNS zone and rtmp-go's `stream` CNAME are preserved.

## Cost Estimate

| Resource | Monthly Cost |
|----------|-------------|
| Platform App (0.5 vCPU / 1 GiB) | ~$7.50 |
| HLS Server (0.5 vCPU / 1 GiB) | ~$7.50 |
| Azure Files (11 GiB total) | ~$0.70 |
| **Total** | **~$15.70/month** |

*Consumption plan pricing, always-on (minReplicas=1). Actual cost depends on request volume.*

## Troubleshooting

### "No rtmp-go deployment found"
Deploy rtmp-go first: `cd ../../rtmp-go/azure && ./deploy.sh`

### "Missing required environment variable" in container logs
Check that all secrets were passed correctly. View logs:
```bash
az containerapp logs show -n <app-name> -g rg-rtmpgo --type console
```

### CORS errors in browser
Verify `CORS_ALLOWED_ORIGIN` matches the platform app's public URL exactly (including protocol). After DNS setup, redeploy with `CORS_ALLOWED_ORIGIN=https://watch.port-80.com`.

### Player loads but no video / "Stream source unavailable"
Verify the full content delivery chain:

1. **Check blob storage** — segments should exist at `hls-content/hls/live_{eventId}/`:
   ```bash
   az storage blob list --account-name <storage> --container-name hls-content \
     --prefix "hls/live_{eventId}/" --query "[].name" -o tsv | head
   ```
2. **Check blob public access** — must be enabled for upstream proxy fallback:
   ```bash
   az storage account show -n <storage> --query allowBlobPublicAccess
   az storage container show -n hls-content --account-name <storage> --query properties.publicAccess
   ```
3. **Check UPSTREAM_ORIGIN** — must include `/hls` prefix:
   ```bash
   az containerapp show -n <hls-app> -g rg-rtmpgo \
     --query "properties.template.containers[0].env[?name=='UPSTREAM_ORIGIN'].value" -o tsv
   # Should be: https://<storage>.blob.core.windows.net/hls-content/hls
   ```
4. **Check HLS_SERVER_BASE_URL** — the `playbackBaseUrl` returned to the browser must point to the HLS server, not the platform:
   ```bash
   az containerapp show -n <platform-app> -g rg-rtmpgo \
     --query "properties.template.containers[0].env[?name=='HLS_SERVER_BASE_URL'].value" -o tsv
   # Should be: https://hls.port-80.com (not watch.port-80.com)
   ```

### Azure Files shows empty directories (SMB cache)
Azure Container Apps mount Azure Files via SMB with aggressive attribute caching. Files written by the transcoder may not appear to the HLS server for several minutes. This is expected — the upstream proxy to Blob Storage handles content delivery. The local mount is a best-effort optimization.

### Revocation sync failures
Check HLS server health: `curl https://<hls-fqdn>/health`
Verify `INTERNAL_API_KEY` matches between platform and HLS server.
The HLS server polls `PLATFORM_APP_URL/api/revocations` — ensure the platform app is reachable.

### HLS segments not found (404)
Verify the HLS transcoder is writing to the `hls-output` share:
```bash
az storage file list --share-name hls-output --account-name <storage> --output table
```
Check that `STREAM_KEY_PREFIX=live_` is set on the HLS server (it maps `{eventId}` to `live_{eventId}` on disk).

### Database issues
SQLite database is stored on the `streamgate-data` Azure Files share at `/data/streamgate.db`. The entrypoint copies it to local disk (`/tmp/`) for POSIX locking compatibility. Check container startup logs for migration errors:
```bash
az containerapp logs show -n <platform-app> -g rg-rtmpgo --type console | head -20
```

### Admin console returns 403
If `ADMIN_ALLOWED_IP` is set, only that IP can access `/admin` and `/api/admin/*`. Check your current IP matches:
```bash
curl -s https://ifconfig.me
az containerapp show -n <platform-app> -g rg-rtmpgo \
  --query "properties.template.containers[0].env[?name=='ADMIN_ALLOWED_IP'].value" -o tsv
```
To disable the restriction, set `ADMIN_ALLOWED_IP` to an empty string.

## Files

```
azure/
├── README.md                    # This file
├── deploy.sh                    # Main deployment script
├── destroy.sh                   # Selective teardown (StreamGate only)
├── dns-deploy.sh                # Add watch/hls CNAME records
├── dns-destroy.sh               # Remove watch/hls CNAME records
└── infra/
    ├── main.bicep               # Container Apps + storage (StreamGate resources)
    ├── main.parameters.json     # Default parameter values
    ├── dns.bicep                # DNS CNAME records for custom domains
    └── dns.parameters.json      # DNS default parameter values
```
