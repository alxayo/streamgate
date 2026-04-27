---
title: "Architecture B — Cloud-Optimized"
---

# Architecture B — Cloud-Optimized ⭐ Recommended

Deploy StreamGate with **Azure Blob Storage** as the segment origin and **Azure Front Door CDN** to cache and deliver segments at the edge. The HLS Server runs in its existing **proxy mode**, fetching from Blob Storage on cache miss and serving authenticated requests. The CDN absorbs the majority of segment delivery traffic.

**Best for:** Most production deployments. Scales from 10 to 5,000+ viewers with near-zero idle cost and minimal code changes.

---

## Architecture Diagram

```
                    ┌──────────────────┐
  Viewers ─────────▶│   Azure Front    │
  (browsers)        │   Door + CDN     │──── TLS + edge caching
                    └────────┬─────────┘
                             │
           ┌─────────────────┼──────────────────┐
           │ /api, /admin, /*│                   │ /streams/*
           ▼                 │                   ▼
  ┌────────────────┐         │          ┌────────────────┐
  │  Platform App  │         │          │  HLS Media     │
  │  (ACA)         │         │          │  Server (ACA)  │
  │  0–4 replicas  │◄────────│──────────│  0–20 replicas │
  │  Port 3000     │  polls  │          │  Port 4000     │
  └───────┬────────┘  /api/  │          └───────┬────────┘
          │         revocations                  │
          ▼                          cache miss? │ fetches from
  ┌────────────────┐                             ▼
  │  PostgreSQL     │                   ┌────────────────┐
  │  (Neon or       │                   │  Azure Blob    │
  │   Flex Server)  │                   │  Storage       │
  └────────────────┘                   │  (segment      │
                                        │   origin)      │
                                        └───────▲────────┘
                                                │ uploads segments
                                        ┌───────┴────────┐
                                        │  FFmpeg         │
                                        │  + upload       │
                                        │  script/tool    │
                                        └────────────────┘
```

### How It Works — Request Flow

1. **FFmpeg** transcodes live video → writes `.m3u8` + `.ts` files → uploads to Azure Blob Storage
2. **Viewer** opens stream → Platform App validates token, issues JWT, redirects to player
3. **Player** requests `GET /streams/:eventId/stream.m3u8` with `Authorization: Bearer <JWT>`
4. **Azure Front Door** routes `/streams/*` to HLS Server ACA
5. **HLS Server** validates JWT → checks local ephemeral cache → on miss, fetches from Blob Storage (`UPSTREAM_ORIGIN`)
6. **Response** flows back through Front Door, which **caches `.ts` segments at the CDN edge**
7. **Subsequent viewers** requesting the same segment get it from CDN cache — no HLS Server hit

The CDN doesn't cache `.m3u8` manifests (they change every segment duration) but does cache `.ts` segments (immutable once written). This means the HLS Server handles manifest requests and cache misses, while the CDN handles the heavy segment delivery.

---

## Azure Services Required

| Service | SKU / Tier | Purpose | Estimated Cost |
|---------|-----------|---------|:--------------:|
| Azure Container Apps | Consumption | Platform App + HLS Server | $0 idle, pay-per-use |
| Azure Container Registry | Basic | Docker image storage | ~$5/mo |
| Azure Blob Storage | Hot tier | Segment origin (upload from FFmpeg) | ~$0.02/GiB/mo storage |
| Azure Front Door | Standard | Routing + TLS + CDN caching | ~$35/mo base + per-request |
| PostgreSQL (Neon) | Free / Pro | Application database | $0–$19/mo |

---

## Step-by-Step Deployment

### 1. Prerequisites

```bash
az login
az extension add --name containerapp

RESOURCE_GROUP="streamgate-rg"
LOCATION="eastus"
ACR_NAME="streamgatecr"
ACA_ENV="streamgate-env"
STORAGE_ACCOUNT="streamgatesegments"
```

### 2. Create Resource Group, ACR, and ACA Environment

```bash
az group create --name $RESOURCE_GROUP --location $LOCATION

az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true

az containerapp env create \
  --name $ACA_ENV \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION
```

### 3. Build and Push Docker Images

```bash
az acr build --registry $ACR_NAME --image streamgate-platform:latest ./platform
az acr build --registry $ACR_NAME --image streamgate-hls:latest ./hls-server
```

### 4. Create Blob Storage Account

```bash
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2

# Create a container for segments
az storage container create \
  --name streams \
  --account-name $STORAGE_ACCOUNT \
  --public-access off

# Get the Blob endpoint URL (used as UPSTREAM_ORIGIN)
BLOB_URL="https://${STORAGE_ACCOUNT}.blob.core.windows.net/streams"
echo "UPSTREAM_ORIGIN=$BLOB_URL"
```

:::warning Private access only
The `streams` container must have `--public-access off`. The HLS Server fetches from it using a SAS token or managed identity — viewers never access Blob Storage directly.
:::

### 5. Set Up Database

Follow the same database setup as [Architecture A, Step 6](./architecture-a-lift-and-shift.md#6-set-up-database).

### 6. Generate Secrets

```bash
SIGNING_SECRET=$(openssl rand -base64 32)
API_KEY=$(openssl rand -hex 24)

# Generate a SAS token for HLS Server to read from Blob Storage
BLOB_SAS=$(az storage container generate-sas \
  --name streams \
  --account-name $STORAGE_ACCOUNT \
  --permissions rl \
  --expiry $(date -u -d "+1 year" +%Y-%m-%dT%H:%MZ) \
  --output tsv)

# Full upstream origin URL with SAS
UPSTREAM_ORIGIN="${BLOB_URL}?${BLOB_SAS}"
```

### 7. Deploy Platform App

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
    ADMIN_PASSWORD_HASH="<your-bcrypt-hash>" \
    HLS_SERVER_BASE_URL="https://<front-door-endpoint>" \
    NEXT_PUBLIC_APP_NAME="StreamGate" \
    SESSION_TIMEOUT_SECONDS="60"
```

### 8. Deploy HLS Server (Proxy Mode)

The key difference from Architecture A — the HLS Server runs in **proxy mode** with `UPSTREAM_ORIGIN` pointing to Azure Blob Storage:

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
  --max-replicas 20 \
  --cpu 0.5 --memory 1Gi \
  --scale-rule-name http-scaling \
  --scale-rule-http-concurrency 100 \
  --env-vars \
    PLAYBACK_SIGNING_SECRET="$SIGNING_SECRET" \
    INTERNAL_API_KEY="$API_KEY" \
    PLATFORM_APP_URL="https://<platform-fqdn>" \
    UPSTREAM_ORIGIN="$UPSTREAM_ORIGIN" \
    CORS_ALLOWED_ORIGIN="https://<front-door-endpoint>" \
    SEGMENT_CACHE_MAX_SIZE_GB="5" \
    SEGMENT_CACHE_MAX_AGE_HOURS="24" \
    PORT="4000"
```

:::note Ephemeral cache
ACA containers have ephemeral local storage (up to a few GiB depending on CPU/memory allocation). The segment cache writes to this local storage. It's lost on restart but provides fast repeat-access for hot segments within each instance. Set `SEGMENT_CACHE_MAX_SIZE_GB` conservatively (2–5 GiB) to stay within ephemeral storage limits.
:::

### 9. Configure Azure Front Door with CDN Caching

```bash
# Create Front Door profile
az afd profile create \
  --profile-name streamgate-fd \
  --resource-group $RESOURCE_GROUP \
  --sku Standard_AzureFrontDoor

# Create endpoint
az afd endpoint create \
  --endpoint-name streamgate \
  --profile-name streamgate-fd \
  --resource-group $RESOURCE_GROUP

# Create origin group for Platform App
az afd origin-group create \
  --origin-group-name platform-origin \
  --profile-name streamgate-fd \
  --resource-group $RESOURCE_GROUP \
  --probe-request-type GET \
  --probe-protocol Https \
  --probe-path "/api/health"

# Create origin group for HLS Server
az afd origin-group create \
  --origin-group-name hls-origin \
  --profile-name streamgate-fd \
  --resource-group $RESOURCE_GROUP \
  --probe-request-type GET \
  --probe-protocol Https \
  --probe-path "/health"
```

**CDN Caching Rules** (critical for performance):

Configure route-level caching:

| Route Pattern | Cache Behavior | TTL | Reason |
|--------------|---------------|:-:|--------|
| `/streams/*/*.ts` | Cache | 1 hour | Segments are immutable once written |
| `/streams/*/*.m3u8` | No cache | — | Manifests change every segment duration |
| `/api/*` | No cache | — | Dynamic API responses |
| `/*` | No cache | — | Web pages (SSR) |

```bash
# Route: /streams/* → HLS Server with caching rules
az afd route create \
  --route-name streams-route \
  --endpoint-name streamgate \
  --profile-name streamgate-fd \
  --resource-group $RESOURCE_GROUP \
  --origin-group hls-origin \
  --patterns-to-match "/streams/*" \
  --forwarding-protocol HttpsOnly \
  --https-redirect Enabled

# Route: /* → Platform App (no caching)
az afd route create \
  --route-name platform-route \
  --endpoint-name streamgate \
  --profile-name streamgate-fd \
  --resource-group $RESOURCE_GROUP \
  --origin-group platform-origin \
  --patterns-to-match "/*" \
  --forwarding-protocol HttpsOnly \
  --https-redirect Enabled
```

:::tip Cache-Control headers
For CDN caching to work, the HLS Server should return appropriate `Cache-Control` headers on `.ts` segment responses. The current server sets `Content-Type` but not `Cache-Control`. Adding `Cache-Control: public, max-age=3600` to `.ts` responses is a small optional code change that significantly improves CDN hit rates.
:::

### 10. FFmpeg Ingest — Uploading to Blob Storage

FFmpeg writes to local disk, then segments are uploaded to Blob Storage. There are several approaches:

#### Option A — blobfuse2 (FUSE mount, recommended)

Mount the Blob Storage container as a local filesystem using [blobfuse2](https://github.com/Azure/azure-storage-fuse):

```bash
# Install blobfuse2
sudo apt-get install blobfuse2

# Configure
cat > /tmp/blobfuse-config.yaml << EOF
allow-other: true
logging:
  type: syslog
  level: log_warning
components:
  - libfuse
  - file_cache
  - attr_cache
  - azstorage
libfuse:
  attribute-expiration-sec: 1
  entry-expiration-sec: 1
file_cache:
  path: /tmp/blobfuse-cache
  timeout-sec: 5
attr_cache:
  timeout-sec: 1
azstorage:
  type: block
  account-name: $STORAGE_ACCOUNT
  account-key: $STORAGE_KEY
  container: streams
EOF

# Mount
mkdir -p /mnt/blob-streams /tmp/blobfuse-cache
blobfuse2 mount /mnt/blob-streams --config-file=/tmp/blobfuse-config.yaml

# Run FFmpeg writing to mount
mkdir -p /mnt/blob-streams/EVENT_ID
ffmpeg -i rtmp://source:1935/live/stream \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f hls -hls_time 2 -hls_list_size 10 \
  -hls_flags delete_segments+append_list \
  -hls_segment_filename "/mnt/blob-streams/EVENT_ID/segment-%03d.ts" \
  "/mnt/blob-streams/EVENT_ID/stream.m3u8"
```

:::warning blobfuse2 cache settings
For live streaming, use aggressive cache expiration (`timeout-sec: 5` or lower for file_cache, `1` for attr_cache) so that newly written segments become visible to the HLS Server quickly. The default cache TTLs are too high for live content.
:::

#### Option B — azcopy sync (periodic upload)

Write segments locally and sync to Blob Storage with `azcopy`:

```bash
# In a separate terminal, sync every second
while true; do
  azcopy sync "./streams/EVENT_ID/" \
    "https://$STORAGE_ACCOUNT.blob.core.windows.net/streams/EVENT_ID?$BLOB_SAS" \
    --delete-destination=true
  sleep 1
done
```

#### Option C — ACA Job with blobfuse2

Run FFmpeg as an ACA container job with blobfuse2 mounted. This keeps ingest in the cloud, close to Blob Storage for minimal upload latency.

---

## Scaling Behavior

### CDN Amplification Effect

The CDN is the key to Architecture B's scalability. As viewer count increases, CDN cache hit ratio increases:

| Viewers | CDN Cache Hit Rate | HLS Server Load | Effective Scale |
|:-------:|:-----------------:|:----------------:|:--------------:|
| 10 | ~50% | 5 requests/sec | 1 replica |
| 100 | ~80% | 20 requests/sec | 1 replica |
| 500 | ~90% | 50 requests/sec | 1–2 replicas |
| 1,000 | ~95% | 50 requests/sec | 2–3 replicas |
| 5,000 | ~98% | 100 requests/sec | 3–5 replicas |

*Cache hit rate assumes 2-second segments and a viewer population arriving gradually. Burst scenarios (everyone joining simultaneously) have lower initial hit rates.*

### Auto-Scaling Thresholds

| Service | Scale Trigger | Min Replicas | Max Replicas |
|---------|:------------:|:------------:|:------------:|
| Platform App | 50 concurrent HTTP | 0 (or 1 during events) | 4 |
| HLS Server | 100 concurrent HTTP | 0 (or 1 during events) | 20 |

### Memory and CPU Sizing

| Service | CPU | Memory | Rationale |
|---------|:---:|:------:|-----------|
| Platform App | 0.5 vCPU | 1 GiB | SSR + API routes + Prisma |
| HLS Server | 0.5 vCPU | 1 GiB | JWT validation + proxy I/O |

Scale horizontally (more replicas) rather than vertically (bigger containers).

---

## Cold Start Mitigation

ACA cold starts (5–15 seconds) affect the first request after scaling from zero.

### Strategy: Event-Aware Scaling

Since StreamGate events have scheduled start times, you can pre-warm containers:

```bash
# Set min replicas to 1 before event starts
az containerapp update \
  --name hls-server \
  --resource-group $RESOURCE_GROUP \
  --min-replicas 1

# After event ends, scale back to zero
az containerapp update \
  --name hls-server \
  --resource-group $RESOURCE_GROUP \
  --min-replicas 0
```

Automate this with **Azure Logic Apps** or a simple cron job that reads event schedules from the Platform App API.

### Cost of Keeping 1 Replica Warm

Keeping one HLS Server replica (0.5 vCPU, 1 GiB) running continuously:
- ~$15/mo (consumption plan pricing)
- Eliminates cold starts entirely
- Worth it for production deployments with regular events

---

## Multi-Instance Considerations

### What Works Out of the Box

- **JWT validation**: Stateless, shared secret — ✅
- **Revocation cache**: Each instance polls independently, builds its own cache — ✅ (30s eventual consistency)
- **Segment cache**: Each instance caches to ephemeral storage independently — ✅ (Blob Storage is source of truth)
- **Inflight dedup**: Per-instance — ⚠️ duplicate Blob fetches possible, but Blob Storage handles it fine
- **Admin sessions**: Encrypted cookies — ✅

### What Needs Attention

**Rate limiters** (Platform App): In-memory `Map` per instance. With 2+ replicas, a client could bypass limits by hitting different instances.

**Shared secrets**: The `PLAYBACK_SIGNING_SECRET` must be consistent across all HLS Server replicas. Rather than duplicating the secret in each container's env vars, the HLS server can fetch it from the platform at startup via `GET /api/internal/config` (authenticated with `INTERNAL_API_KEY`). The platform stores secrets in its `SystemConfig` database table, providing a single source of truth. This simplifies secret rotation — update once via the admin console at `/admin/config`, then restart HLS containers.

**Fix** (optional): Add Azure Cache for Redis (Basic C0, ~$13/mo):

```bash
az redis create \
  --name streamgate-redis \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Basic --vm-size C0
```

Then replace the `Map`-based `RateLimiter` with a Redis-backed implementation. For most deployments, the per-instance limits are sufficient.

---

## Monitoring and Observability

### Key Metrics to Watch

| Metric | Source | Alert Threshold |
|--------|--------|:--------------:|
| ACA replica count | Azure Monitor | > 0 when no events (cost) |
| HLS Server HTTP 5xx rate | ACA logs | > 1% |
| CDN cache hit ratio | Front Door analytics | < 70% (investigate) |
| Blob Storage egress | Storage metrics | Unexpected spike |
| Revocation sync age | HLS Server logs | > 5 minutes |

### Front Door Analytics

Azure Front Door provides built-in analytics:
- Request count by route (streams vs. API)
- Cache hit/miss ratio
- Latency percentiles (P50, P95, P99)
- Geographic distribution of viewers

### Cost Monitoring

Set up Azure Cost Management alerts:

```bash
az consumption budget create \
  --budget-name streamgate-monthly \
  --amount 100 \
  --time-grain Monthly \
  --resource-group $RESOURCE_GROUP \
  --notifications "[{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":80,\"contactEmails\":[\"admin@example.com\"]}]"
```

---

## Upgrade Path to Architecture C

If you consistently serve 5,000+ concurrent viewers and want to eliminate the HLS Server as a bottleneck:

1. Modify Platform App to generate **SAS-signed Blob URLs** instead of JWTs for stream access
2. Rewrite `.m3u8` manifests to include SAS-signed segment URLs
3. Point Azure Front Door `/streams/*` directly at Blob Storage
4. Remove HLS Server containers

See [Architecture C — Maximum Scale](./architecture-c-maximum-scale.md) for the full approach.
