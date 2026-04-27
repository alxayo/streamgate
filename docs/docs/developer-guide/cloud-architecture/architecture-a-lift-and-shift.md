---
title: "Architecture A — Lift-and-Shift"
---

# Architecture A — Lift-and-Shift

Deploy StreamGate to Azure with **zero application code changes**. Both services run as Azure Container Apps with Azure Files providing shared filesystem storage that preserves the existing `fs.createReadStream()` code path.

**Best for:** Quick deployment, events under ~500 concurrent viewers, teams that want to avoid code changes.

---

## Architecture Diagram

```
                    ┌──────────────────┐
  Viewers ─────────▶│   Azure Front    │
  (browsers)        │   Door           │──── TLS termination
                    └────────┬─────────┘
                             │
                ┌────────────┼────────────┐
                │ /api, /admin, /*        │ /streams/*
                ▼                         ▼
       ┌────────────────┐       ┌────────────────┐
       │  Platform App  │       │  HLS Media     │
       │  (ACA)         │       │  Server (ACA)  │
       │  0–4 replicas  │◄──────│  0–10 replicas │
       │  Port 3000     │ polls │  Port 4000     │
       └───────┬────────┘ /api/ └───────┬────────┘
               │         revocations    │
               ▼                        │ reads segments
       ┌────────────────┐       ┌───────▼────────┐
       │  PostgreSQL     │       │  Azure Files   │
       │  (Neon or       │       │  (Premium SMB) │
       │   Flex Server)  │       │  Mounted to    │
       └────────────────┘       │  HLS containers│
                                └───────▲────────┘
                                        │ writes segments
                                ┌───────┴────────┐
                                │  FFmpeg         │
                                │  (ACA Job or    │
                                │   dedicated VM) │
                                └────────────────┘
```

---

## Azure Services Required

| Service | SKU / Tier | Purpose | Estimated Cost |
|---------|-----------|---------|:--------------:|
| Azure Container Apps | Consumption | Platform App + HLS Server | $0 idle, pay-per-use |
| Azure Container Registry | Basic | Docker image storage | ~$5/mo |
| Azure Files | Premium (SMB) | Shared HLS segment storage | ~$0.10/GiB/mo provisioned |
| Azure Front Door | Standard | Routing + TLS | ~$35/mo base + per-request |
| PostgreSQL (Neon) | Free / Pro | Application database | $0–$19/mo |
| *or* Azure PostgreSQL Flex | B1ms | Application database | ~$12/mo |

---

## Step-by-Step Deployment

### 1. Prerequisites

```bash
# Install Azure CLI
az login
az extension add --name containerapp

# Set variables
RESOURCE_GROUP="streamgate-rg"
LOCATION="eastus"
ACR_NAME="streamgatecr"
ACA_ENV="streamgate-env"
```

### 2. Create Resource Group and Container Registry

```bash
az group create --name $RESOURCE_GROUP --location $LOCATION

az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true
```

### 3. Build and Push Docker Images

```bash
# From repository root
az acr build --registry $ACR_NAME --image streamgate-platform:latest ./platform
az acr build --registry $ACR_NAME --image streamgate-hls:latest ./hls-server
```

### 4. Create Azure Files Share

```bash
STORAGE_ACCOUNT="streamgatefiles"

az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Premium_LRS \
  --kind FileStorage

az storage share create \
  --name streams \
  --account-name $STORAGE_ACCOUNT \
  --quota 100
```

### 5. Create Container Apps Environment

```bash
az containerapp env create \
  --name $ACA_ENV \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION

# Mount Azure Files to the environment
STORAGE_KEY=$(az storage account keys list \
  --account-name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --query "[0].value" -o tsv)

az containerapp env storage set \
  --name $ACA_ENV \
  --resource-group $RESOURCE_GROUP \
  --storage-name streamfiles \
  --azure-file-account-name $STORAGE_ACCOUNT \
  --azure-file-account-key $STORAGE_KEY \
  --azure-file-share-name streams \
  --access-mode ReadWrite
```

### 6. Set Up Database

**Option A — Neon (scale-to-zero):**

1. Create a project at [neon.tech](https://neon.tech)
2. Copy the connection string: `postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`

**Option B — Azure PostgreSQL Flexible Server:**

```bash
az postgres flexible-server create \
  --resource-group $RESOURCE_GROUP \
  --name streamgate-db \
  --location $LOCATION \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --admin-user streamgate \
  --admin-password '<strong-password>' \
  --storage-size 32
```

**Run Prisma migrations** (from your local machine or a CI/CD pipeline):

```bash
# Update platform/prisma/schema.prisma datasource to postgresql
# Set DATABASE_URL to your PostgreSQL connection string
cd platform
npx prisma migrate deploy
```

### 7. Generate Secrets

```bash
# Playback signing secret (min 32 chars)
SIGNING_SECRET=$(openssl rand -base64 32)

# Internal API key
API_KEY=$(openssl rand -hex 24)

# Admin password hash
ADMIN_HASH=$(node -e "const bcrypt=require('bcrypt');bcrypt.hash('your-password',12).then(h=>console.log(h))")
```

### 8. Deploy Platform App

```bash
ACR_SERVER="${ACR_NAME}.azurecr.io"

az containerapp create \
  --name platform \
  --resource-group $RESOURCE_GROUP \
  --environment $ACA_ENV \
  --image "${ACR_SERVER}/streamgate-platform:latest" \
  --registry-server $ACR_SERVER \
  --target-port 3000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 4 \
  --scale-rule-name http-scaling \
  --scale-rule-http-concurrency 50 \
  --env-vars \
    DATABASE_URL="<your-postgresql-connection-string>" \
    PLAYBACK_SIGNING_SECRET="$SIGNING_SECRET" \
    INTERNAL_API_KEY="$API_KEY" \
    ADMIN_PASSWORD_HASH="$ADMIN_HASH" \
    HLS_SERVER_BASE_URL="https://<hls-fqdn>" \
    NEXT_PUBLIC_APP_NAME="StreamGate" \
    SESSION_TIMEOUT_SECONDS="60"
```

### 9. Deploy HLS Server

```bash
az containerapp create \
  --name hls-server \
  --resource-group $RESOURCE_GROUP \
  --environment $ACA_ENV \
  --image "${ACR_SERVER}/streamgate-hls:latest" \
  --registry-server $ACR_SERVER \
  --target-port 4000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 10 \
  --scale-rule-name http-scaling \
  --scale-rule-http-concurrency 100 \
  --env-vars \
    PLAYBACK_SIGNING_SECRET="$SIGNING_SECRET" \
    INTERNAL_API_KEY="$API_KEY" \
    PLATFORM_APP_URL="https://<platform-fqdn>" \
    STREAM_ROOT="/mnt/streams" \
    CORS_ALLOWED_ORIGIN="https://<platform-fqdn>" \
    PORT="4000"
```

Then mount the Azure Files volume to the HLS Server container:

```bash
az containerapp update \
  --name hls-server \
  --resource-group $RESOURCE_GROUP \
  --set-env-vars STREAM_ROOT="/mnt/streams" \
  --container-name hls-server
```

:::note Volume mount via YAML
ACA volume mounts are easiest to configure via a YAML deployment file. Export the container app config with `az containerapp show --name hls-server ... -o yaml`, add the volume mount under `template.volumes` and `template.containers[].volumeMounts`, then apply with `az containerapp update --yaml app.yaml`.

```yaml
template:
  volumes:
    - name: stream-storage
      storageName: streamfiles
      storageType: AzureFile
  containers:
    - name: hls-server
      volumeMounts:
        - volumeName: stream-storage
          mountPath: /mnt/streams
```
:::

### 10. Configure Azure Front Door

```bash
az afd profile create \
  --profile-name streamgate-fd \
  --resource-group $RESOURCE_GROUP \
  --sku Standard_AzureFrontDoor

# Add endpoint, origin groups, origins, and routes
# Route /streams/* → HLS Server ACA
# Route /* → Platform App ACA
```

:::tip Simplified routing
If you don't need CDN or global distribution, you can skip Azure Front Door and use the ACA ingress URLs directly. Each container app gets a public FQDN like `platform.happyground-xxx.eastus.azurecontainerapps.io`.
:::

### 11. FFmpeg Ingest

FFmpeg needs write access to the Azure Files share. Options:

**Option A — ACA Job (recommended for on-demand):**

Create a container with FFmpeg that mounts the same Azure Files share:

```bash
az containerapp job create \
  --name ffmpeg-ingest \
  --resource-group $RESOURCE_GROUP \
  --environment $ACA_ENV \
  --image linuxserver/ffmpeg:latest \
  --trigger-type Manual \
  --cpu 2.0 --memory 4Gi \
  --env-vars EVENT_ID="<event-uuid>" RTMP_SOURCE="rtmp://source:1935/live/stream"
```

**Option B — Local machine with Azure Files mount:**

Mount the Azure Files share on your local machine and run FFmpeg locally:

```bash
# macOS/Linux: Mount Azure Files via SMB
sudo mount -t cifs \
  //$STORAGE_ACCOUNT.file.core.windows.net/streams \
  /mnt/azure-streams \
  -o vers=3.0,username=$STORAGE_ACCOUNT,password=$STORAGE_KEY,dir_mode=0777,file_mode=0777

# Run FFmpeg writing to the mounted share
ffmpeg -i rtmp://source:1935/live/stream \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "/mnt/azure-streams/EVENT_ID/segment-%03d.ts" \
  "/mnt/azure-streams/EVENT_ID/stream.m3u8"
```

---

## Scaling Behavior

| Viewers | Platform Replicas | HLS Replicas | Estimated Monthly Cost |
|:-------:|:-----------------:|:------------:|:---------------------:|
| 0 (idle) | 0 | 0 | ~$2 |
| 10–50 | 1 | 1 | ~$15 |
| 50–200 | 1–2 | 2–4 | ~$30–50 |
| 200–500 | 2–3 | 4–8 | ~$60–100 |

### Auto-Scaling Configuration

ACA scales based on concurrent HTTP requests per replica:

- **Platform App**: Scale at 50 concurrent requests (handles API calls, page loads)
- **HLS Server**: Scale at 100 concurrent requests (handles segment fetches — lightweight I/O)

Each viewer generates approximately:
- 1 segment request every 2 seconds (the segment duration)
- 1 manifest request every 2 seconds
- 1 heartbeat every 30 seconds

So 100 viewers ≈ 100 concurrent segment/manifest requests to HLS Server.

---

## Limitations

### Azure Files Throughput

Azure Files Premium SMB has throughput limits based on provisioned share size:

| Share Size | Max Throughput | Approx. Max Viewers |
|:----------:|:--------------:|:-------------------:|
| 100 GiB | 110 MiB/s | ~150–200 |
| 500 GiB | 200 MiB/s | ~300–400 |
| 1 TiB | 300 MiB/s | ~500 |

*Assumes 2 Mbps stream = ~250 KB/segment, 1 segment request per viewer per 2 seconds.*

If you need more than ~500 concurrent viewers, move to [Architecture B](./architecture-b-cloud-optimized.md).

### Azure Files Latency

SMB-mounted Azure Files adds ~1–5ms per file read compared to local SSD. This is negligible for HLS streaming (segments are large enough that throughput matters more than latency).

### Cold Starts

When ACA scales from 0 → 1, expect a **5–15 second cold start**. Mitigation strategies:

- **Set `minReplicas: 1` during scheduled events** — costs ~$5–8/mo per service but eliminates cold starts
- **Use ACA activation scaling** — container warms up before receiving traffic
- **Pre-warm via cron** — schedule an HTTP ping before event start time

### Rate Limiter Gap

With multiple Platform App replicas, in-memory rate limiters are per-instance. A client could hit different instances and bypass limits. For strict enforcement:

- Add **Azure Cache for Redis** (Basic, ~$13/mo)
- Replace the `Map`-based `RateLimiter` class with a Redis-backed implementation

For most events, the per-instance limits are sufficient as a deterrent.

### Shared Secrets Management

Shared secrets (e.g., `PLAYBACK_SIGNING_SECRET`) are stored in the platform's `SystemConfig` database table and served via `GET /api/internal/config`. In this topology, the HLS server can fetch secrets from the platform at startup rather than requiring them as duplicate env vars. Since both services share the Azure Files mount path to the same database, the platform is the single source of truth for secret management. Manage secrets in the admin console at `/admin/config`.

---

## Monitoring

### Health Checks

Both services expose health endpoints:
- Platform App: `GET /api/health` (or any page load)
- HLS Server: `GET /health`

Configure ACA health probes:

```yaml
template:
  containers:
    - name: hls-server
      probes:
        - type: Liveness
          httpGet:
            path: /health
            port: 4000
          periodSeconds: 30
        - type: Readiness
          httpGet:
            path: /health
            port: 4000
          initialDelaySeconds: 5
```

### Logging

ACA sends container logs to Azure Log Analytics. Query with:

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "hls-server"
| where Log_s contains "error"
| order by TimeGenerated desc
```

### Alerts

Set up alerts for:
- ACA replica count > 0 for more than expected (cost control)
- Azure Files throughput approaching limits
- HTTP 5xx error rate > 1%

---

## Upgrade Path

When you outgrow Architecture A (~500 viewer limit), migrate to [Architecture B](./architecture-b-cloud-optimized.md):

1. Create an Azure Blob Storage account
2. Upload existing segments or configure FFmpeg to write there
3. Set `UPSTREAM_ORIGIN` on the HLS Server to point at Blob Storage
4. Add Azure Front Door CDN caching for `/streams/*`
5. Azure Files can be removed once migration is complete

The HLS Server's existing proxy mode handles this transparently — no code changes needed.
