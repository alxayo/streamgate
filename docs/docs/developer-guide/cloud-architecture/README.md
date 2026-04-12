---
title: Cloud Architecture — Azure Deployment
---

# Cloud Architecture — Azure Deployment

This section provides three fully documented approaches for deploying StreamGate to **Microsoft Azure**, ranging from a minimal-change lift-and-shift to a CDN-first architecture that can serve tens of thousands of concurrent viewers.

All three approaches share the same goals:

- **Scale to zero** — near-zero cost when no events are running
- **Elastic scaling** — handle 10 viewers or 10,000 viewers without manual intervention
- **Production-ready** — TLS, monitoring, graceful failover

---

## Current Architecture Recap

StreamGate consists of two independently deployable services:

| Service | Technology | Port | Stateful? |
|---------|-----------|:----:|:---------:|
| **Platform App** | Next.js 14+ (standalone) | 3000 | Database (Prisma/PostgreSQL) |
| **HLS Media Server** | Express.js | 4000 | In-memory only (revocation cache, inflight dedup) |

They communicate through:
- **JWT tokens** — Browser sends `Authorization: Bearer` to HLS Server on every segment request
- **Revocation polling** — HLS Server polls `GET /api/revocations` from Platform App every 30 seconds

Both services have Docker images (`node:20-alpine`, multi-stage builds) ready for containerized deployment.

### Scaling Constraints from Source Code

| Component | Current Implementation | Multi-Instance Impact |
|-----------|----------------------|----------------------|
| Rate limiters (Platform) | In-memory `Map` per process | Limits not enforced across instances — needs Redis for strict enforcement |
| Active sessions | Database (`ActiveSession` table) | ✅ Scalable with shared database |
| JWT signing/verification | HMAC-SHA256 shared secret | ✅ Stateless, fully scalable |
| Admin sessions | Encrypted cookies (`iron-session`) | ✅ Stateless, no server-side store |
| Revocation cache (HLS) | In-memory `Map`, populated by polling | Per-instance — each instance independently polls and builds its own cache (eventually consistent within 30s) |
| Segment cache (HLS) | Local disk LRU | Per-instance — each instance caches independently; acceptable when Blob Storage is the source of truth |
| Inflight deduplication (HLS) | In-memory `Map<string, Promise>` | Per-instance — duplicate upstream fetches possible across instances but not incorrect |

---

## Approach Comparison

| | [Architecture A](./architecture-a-lift-and-shift.md) | [Architecture B](./architecture-b-cloud-optimized.md) | [Architecture C](./architecture-c-maximum-scale.md) |
|---|---|---|---|
| **Name** | Lift-and-Shift | Cloud-Optimized ⭐ | Maximum Scale |
| **Segment storage** | Azure Files (SMB mount) | Azure Blob Storage (upstream proxy) | Azure Blob Storage (direct access) |
| **Content delivery** | HLS Server serves all requests | CDN caches segments, HLS Server handles misses | CDN serves everything, no HLS Server |
| **Code changes** | None (Docker images as-is) | Minimal (FFmpeg upload script) | Major (auth model rewrite) |
| **Max viewers** | ~500 (Files throughput limit) | 5,000+ (CDN absorbs load) | Unlimited (CDN-first) |
| **Idle cost** | ~$2/mo | ~$0.50/mo | ~$0.50/mo |
| **Complexity** | Low | Medium | High |

---

## Cost Estimates (Monthly, US East Region)

### Idle — No Active Events

| Component | Arch A | Arch B | Arch C |
|-----------|:------:|:------:|:------:|
| Compute (ACA) | $0 | $0 | $0 |
| Database (Neon free tier) | $0 | $0 | $0 |
| Storage | ~$2 (Azure Files) | ~$0.50 (Blob) | ~$0.50 (Blob) |
| **Total** | **~$2** | **~$0.50** | **~$0.50** |

### Small Event — 50 viewers, 2-hour event, twice per month

| Component | Arch A | Arch B | Arch C |
|-----------|:------:|:------:|:------:|
| Compute | ~$8 | ~$5 | ~$3 |
| Database | ~$0 | ~$0 | ~$0 |
| Storage | ~$2 | ~$1 | ~$1 |
| Egress / CDN | ~$5 | ~$3 | ~$3 |
| **Total** | **~$15** | **~$9** | **~$7** |

### Large Event — 1,000 viewers, 3-hour event, four times per month

| Component | Arch A | Arch B | Arch C |
|-----------|:------:|:------:|:------:|
| Compute | ~$60 | ~$35 | ~$10 |
| Database | ~$12 | ~$12 | ~$5 |
| Storage | ~$5 | ~$3 | ~$3 |
| Egress / CDN | ~$40 | ~$25 | ~$50 |
| **Total** | **~$117** | **~$75** | **~$68** |

*Estimates assume ACA Consumption plan, Neon PostgreSQL (free tier for small, Pro for large). Actual costs vary by region and usage patterns.*

---

## Shared Azure Services

All three architectures use these common services:

### Azure Container Apps (ACA)

The compute layer for both services. Key capabilities:
- **Scale to zero** — `minReplicas: 0` means no compute charges when idle
- **HTTP-based auto-scaling** — scales based on concurrent requests (configurable threshold)
- **Free monthly grant** — 180,000 vCPU-seconds + 360,000 GiB-seconds + 2M requests
- **Custom domains + TLS** — built-in certificate management
- **Docker-native** — push images to Azure Container Registry, deploy directly

### Database — PostgreSQL

Two options depending on cost tolerance:

| Option | Idle Cost | Scale to Zero | Best For |
|--------|:---------:|:------------:|----------|
| **Neon Serverless PostgreSQL** | $0 (free tier: 0.5 GiB storage, 190 hours compute) | ✅ True scale-to-zero | Cost-first deployments |
| **Azure Database for PostgreSQL Flexible Server** | ~$12/mo (B1ms) | ❌ (stop/start pauses compute, storage always billed) | Azure-native, production SLA |

Both are fully compatible with Prisma ORM — the only change is the `DATABASE_URL` connection string.

### Azure Front Door

Routes traffic to the correct service and provides CDN caching:
- Routes `/api/*`, `/admin/*`, and web pages → Platform App (ACA)
- Routes `/streams/*` → HLS Server (ACA) or Blob Storage (Arch C)
- CDN edge caching for `.ts` segments (Arch B and C)
- TLS termination, WAF (optional), global load balancing

---

## Recommendation

**Start with [Architecture B (Cloud-Optimized)](./architecture-b-cloud-optimized.md)** unless you have a specific reason not to:

- Near-zero idle cost ($0.50/mo)
- Scales to thousands of viewers via CDN
- Uses existing Docker images and proxy mode — minimal code changes
- Clear upgrade path to Architecture C if you outgrow it

**Choose [Architecture A](./architecture-a-lift-and-shift.md)** if you want zero code changes and your events will stay under ~500 concurrent viewers.

**Choose [Architecture C](./architecture-c-maximum-scale.md)** if you need to serve 5,000+ concurrent viewers at the lowest possible per-viewer cost and are willing to invest in the auth model rewrite.

---

## Detailed Guides

- **[Architecture A — Lift-and-Shift](./architecture-a-lift-and-shift.md)**: Azure Container Apps + Azure Files. Zero code changes, deploy existing Docker images as-is.
- **[Architecture B — Cloud-Optimized](./architecture-b-cloud-optimized.md)** ⭐: Azure Container Apps + Blob Storage + CDN. Minimal code changes, massive scalability via CDN caching.
- **[Architecture C — Maximum Scale](./architecture-c-maximum-scale.md)**: CDN-first delivery with SAS tokens. Eliminates HLS Server for segment delivery, unlimited scale.

---

## Further Reading

- [Deployment Guide](../deployment.md) — General deployment topologies, database migration, environment variables
- [HLS Media Server](../hls-server.md) — Server architecture, request flow, content resolution
- [Architecture Overview](../architecture.md) — System design, inter-service communication
- [Security](../security.md) — JWT model, token lifecycle, revocation
