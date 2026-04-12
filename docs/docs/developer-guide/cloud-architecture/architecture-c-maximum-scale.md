---
title: "Architecture C — Maximum Scale"
---

# Architecture C — Maximum Scale

Serve HLS video segments **directly from Azure Blob Storage via CDN** using short-lived SAS (Shared Access Signature) tokens for authentication. This eliminates the HLS Media Server from the segment delivery path entirely, enabling virtually unlimited concurrent viewers.

**Best for:** Events with 5,000+ concurrent viewers where per-viewer cost must be minimized. Requires significant code changes to the authentication model.

:::warning Major code changes required
This architecture replaces StreamGate's JWT-per-request model with SAS-signed Blob URLs. This requires modifying the Platform App (manifest rewriting, SAS token generation), the video player (auth model), and removing the HLS Server from the streaming path. Evaluate [Architecture B](./architecture-b-cloud-optimized.md) first — it handles most use cases with minimal changes.
:::

---

## Architecture Diagram

```
                    ┌──────────────────────┐
  Viewers ─────────▶│    Azure Front Door   │──── Global CDN edge
  (browsers)        │    + WAF              │
                    └──────────┬────────────┘
                               │
          ┌────────────────────┼──────────────────────┐
          │ /api, /admin, /*   │ /streams/*.m3u8      │ /streams/*.ts
          │                    │ (manifest proxy)      │ (direct CDN)
          ▼                    ▼                       ▼
  ┌────────────────┐  ┌────────────────┐     ┌────────────────┐
  │  Platform App  │  │  Manifest      │     │  Azure Blob    │
  │  (ACA)         │  │  Rewriter      │     │  Storage       │
  │  0–4 replicas  │  │  (ACA)         │     │  + CDN cache   │
  │                │  │  0–5 replicas  │     │                │
  └───────┬────────┘  └───────┬────────┘     └───────▲────────┘
          │                   │                       │
          ▼                   │ reads manifests       │ uploads
  ┌────────────────┐          │ + signs URLs          │ segments
  │  PostgreSQL     │          ▼                       │
  │  (Neon)         │  ┌────────────────┐     ┌───────┴────────┐
  └────────────────┘  │  Azure Blob    │     │  FFmpeg         │
                      │  Storage       │     │  + upload       │
                      │  (same account)│     └────────────────┘
                      └────────────────┘
```

### How It Works

1. **FFmpeg** transcodes and uploads `.m3u8` + `.ts` to Blob Storage
2. **Viewer** enters token code → Platform App validates → issues a **session token** (not a stream JWT)
3. **Player** requests manifest: `GET /streams/:eventId/stream.m3u8` with session token
4. **Manifest Rewriter** (lightweight ACA service):
   - Authenticates the viewer (validates session token)
   - Reads the original `.m3u8` from Blob Storage
   - Rewrites each `.ts` URL to include a short-lived **SAS query parameter**
   - Returns the modified manifest
5. **Player** fetches `.ts` segments directly from the **SAS-signed Blob URL via CDN**
6. **CDN** caches segments at edge nodes — subsequent requests never hit origin
7. **SAS tokens expire** after a short window (e.g., 5 minutes) — manifests are re-fetched every segment duration, providing fresh SAS tokens

The key insight: **manifests are small and dynamic** (rewritten per-request), while **segments are large and static** (served directly from CDN). By splitting these concerns, the compute layer only handles lightweight manifest requests.

---

## Azure Services Required

| Service | SKU / Tier | Purpose | Estimated Cost |
|---------|-----------|---------|:--------------:|
| Azure Container Apps | Consumption | Platform App + Manifest Rewriter | $0 idle, pay-per-use |
| Azure Container Registry | Basic | Docker image storage | ~$5/mo |
| Azure Blob Storage | Hot tier | Segment + manifest origin | ~$0.02/GiB/mo |
| Azure Front Door | Standard | Routing + TLS + CDN | ~$35/mo base |
| PostgreSQL (Neon) | Free / Pro | Application database | $0–$19/mo |

**What's NOT needed:**
- No HLS Media Server containers for segment delivery
- No Azure Files
- No Redis (unless rate limiting is critical)

---

## Authentication Model Change

### Current Model (JWT per request)

```
Player → HLS Server: GET /streams/evt/seg-001.ts
                     Authorization: Bearer <JWT>
HLS Server: Verify JWT signature → Verify path → Serve segment
```

Every segment request requires a running HLS Server instance to validate the JWT.

### New Model (SAS-signed URLs)

```
Player → Manifest Rewriter: GET /streams/evt/stream.m3u8
                            Authorization: Bearer <session-token>
Manifest Rewriter:
  1. Validate session token
  2. Read original manifest from Blob Storage
  3. Rewrite segment URLs:
     seg-001.ts → https://blob.../evt/seg-001.ts?sv=...&se=...&sig=...
  4. Return modified manifest

Player → CDN/Blob: GET https://blob.../evt/seg-001.ts?sv=...&se=...&sig=...
                   (no Authorization header — SAS token is in the URL)
CDN: Serve from cache (or Blob origin on miss)
```

Only manifest requests (1 per segment duration per viewer) hit the compute layer. Segment requests (the heavy traffic) go directly to CDN/Blob.

### SAS Token Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `sv` | API version | Service version |
| `se` | Now + 5 minutes | Expiry — limits access window |
| `sp` | `r` (read) | Permission — read only |
| `sr` | `b` (blob) | Resource — individual blob |
| `sig` | HMAC signature | Cryptographic signature |

The Platform App generates SAS tokens using the Blob Storage account key or a **User Delegation Key** (Azure AD-based, more secure).

---

## Code Changes Required

### 1. Manifest Rewriter Service (New)

A lightweight Express.js or Next.js API route that:

```typescript
// Pseudocode for manifest rewriter
async function handleManifestRequest(req, res) {
  // 1. Validate viewer session (similar to current JWT validation)
  const session = await validateSession(req.headers.authorization);
  if (!session) return res.status(401).json({ error: 'unauthorized' });

  // 2. Read original manifest from Blob Storage
  const eventId = req.params.eventId;
  const manifest = await blobClient.downloadToBuffer(
    `streams/${eventId}/stream.m3u8`
  );

  // 3. Generate SAS tokens for each segment URL
  const rewritten = rewriteManifest(manifest.toString(), eventId, {
    expiresIn: 5 * 60, // 5 minutes
  });

  // 4. Return modified manifest
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache'); // Manifests are never cached
  res.send(rewritten);
}

function rewriteManifest(content, eventId, sasOptions) {
  // Replace relative .ts URLs with SAS-signed absolute URLs
  return content.replace(
    /^([^\s#]+\.ts)$/gm,
    (filename) => {
      const sasToken = generateSasToken(`streams/${eventId}/${filename}`, sasOptions);
      return `https://${STORAGE_ACCOUNT}.blob.core.windows.net/streams/${eventId}/${filename}?${sasToken}`;
    }
  );
}
```

This could be:
- A new API route in the Platform App (`/api/streams/:eventId/manifest`)
- A standalone microservice (smallest possible ACA container)

### 2. Player Modification

The hls.js player currently injects `Authorization: Bearer` headers via `xhrSetup`. In Architecture C:

```typescript
// Current (Architecture A/B)
const hls = new Hls({
  xhrSetup: (xhr) => {
    xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
  },
});
hls.loadSource('/streams/event-id/stream.m3u8');

// Architecture C
const hls = new Hls({
  xhrSetup: (xhr, url) => {
    // Only add auth header for manifest requests (to our server)
    // Segment requests go to Blob CDN with SAS in URL — no header needed
    if (url.includes('.m3u8')) {
      xhr.setRequestHeader('Authorization', `Bearer ${getSessionToken()}`);
    }
    // .ts URLs already have SAS tokens embedded by the manifest rewriter
  },
});
// Manifest URL points to our rewriter, which returns SAS-signed segment URLs
hls.loadSource('/api/streams/event-id/manifest');
```

### 3. FFmpeg Upload to Blob Storage

Same as [Architecture B, Option A (blobfuse2)](./architecture-b-cloud-optimized.md#option-a--blobfuse2-fuse-mount-recommended) or Option B (azcopy sync).

### 4. Platform App Changes

- New API route or service for manifest rewriting with SAS token generation
- Session token issuance (simpler than JWT — just needs to identify the viewer and event)
- Revocation: Instead of the HLS Server revocation cache, revocation is enforced at the manifest level — revoked viewers get 403 on manifest requests, and their existing SAS tokens expire within minutes

### 5. HLS Server — Reduced Role or Removed

The HLS Media Server is **no longer needed for segment delivery**. Options:
- **Remove entirely** — all streaming goes through the manifest rewriter + CDN
- **Keep for VOD/rewind** — proxy mode for on-demand content that isn't in Blob Storage
- **Keep as fallback** — Safari users who can't use the new auth model

---

## Scaling Behavior

### Compute Load

| Request Type | Volume (per viewer) | Handled By | Scale Impact |
|-------------|:------------------:|:----------:|:------------:|
| Manifest (`.m3u8`) | 1 request / 2 seconds | Manifest Rewriter (ACA) | Low — lightweight string manipulation |
| Segment (`.ts`) | 1 request / 2 seconds | CDN / Blob Storage | Zero compute — all CDN |
| Heartbeat | 1 request / 30 seconds | Platform App (ACA) | Negligible |

For 1,000 concurrent viewers: ~500 manifest requests/sec to ACA (very light) + ~500 segment requests/sec to CDN (no compute).

### Cost at Scale

| Viewers | ACA Compute | CDN/Egress | Total (3-hour event) |
|:-------:|:-----------:|:----------:|:-------------------:|
| 100 | ~$0.10 | ~$1 | ~$1 |
| 1,000 | ~$0.50 | ~$10 | ~$11 |
| 5,000 | ~$2 | ~$50 | ~$52 |
| 10,000 | ~$4 | ~$100 | ~$104 |

*Egress: 2 Mbps stream × 3 hours = ~2.7 GiB per viewer. CDN egress at $0.087/GiB for first 10 TB.*

The compute cost is nearly flat — the manifest rewriter is so lightweight that a few replicas handle thousands of viewers. The dominant cost is CDN egress, which scales linearly with viewer count.

---

## Security Considerations

### SAS Token Security

- **Short-lived**: SAS tokens expire in 5 minutes, limiting exposure of leaked URLs
- **Read-only**: `sp=r` permission — no write/delete access
- **Per-blob**: Each SAS token is scoped to a specific segment file
- **Rotating manifests**: Viewers must re-fetch the manifest every segment duration, getting fresh SAS tokens
- **Revocation**: Deny at the manifest level — revoked viewers can't get new SAS tokens; existing ones expire in minutes

### Comparison with JWT Model

| Aspect | JWT (Arch A/B) | SAS (Arch C) |
|--------|:-----------:|:----------:|
| Auth enforcement | Every segment request | Manifest requests only |
| Revocation speed | Immediate (HLS Server checks cache) | Up to SAS expiry (5 min) |
| URL sharability | URLs are useless without JWT header | SAS URLs are self-contained (shareable until expiry) |
| Token in URL | No (header-based) | Yes (query parameter) |

**Trade-off**: SAS tokens in URLs are less secure than header-based JWTs (URLs can be shared, appear in logs). Mitigate with:
- Very short SAS expiry (2–5 minutes)
- IP-restricted SAS tokens (if Azure AD-based)
- WAF rate limiting at Azure Front Door
- Monitoring for anomalous access patterns

### Single-Device Enforcement

In Architecture C, single-device enforcement moves from JWT session claims to the manifest rewriter:
- Manifest rewriter checks `ActiveSession` table (same as current token validation)
- Only one active session per token can request manifests
- Heartbeats still flow to Platform App as before

---

## Revocation Behavior

| Scenario | Current (Arch A/B) | Architecture C |
|----------|-------------------|----------------|
| Admin revokes a token | HLS Server learns within 30s (polling), blocks JWT | Manifest rewriter immediately returns 403; existing SAS tokens expire in ≤5 min |
| Admin deactivates event | Same as above | Same — manifest requests fail immediately |
| Viewer shares a SAS URL | N/A (JWT header-based) | URL works until SAS expiry (≤5 min); next manifest fetch requires auth |

---

## Implementation Complexity

| Component | Effort | Risk |
|-----------|:------:|:----:|
| Manifest Rewriter service | Medium | Low — straightforward string manipulation + SAS generation |
| Player auth model change | Medium | Medium — must handle both manifest (auth header) and segment (SAS in URL) requests |
| FFmpeg upload to Blob | Low | Low — same as Architecture B |
| Remove HLS Server from streaming | Low | Low — just routing changes |
| SAS token generation | Low | Low — well-documented Azure SDK feature |
| Safari compatibility testing | Medium | Medium — Safari's native HLS may handle SAS URLs differently |
| Single-device enforcement | Medium | Medium — must replicate current session logic in manifest rewriter |
| **Total** | **High** | **Medium** |

Estimated implementation effort: 2–4 weeks for an experienced developer familiar with the codebase.

---

## Migration Path from Architecture B

If you're already running Architecture B, the migration is incremental:

### Phase 1: Add Manifest Rewriter (parallel)
- Deploy the manifest rewriter alongside the existing HLS Server
- Add a `/api/streams/:eventId/manifest` route to Platform App
- Test with a subset of viewers or a test event

### Phase 2: Update Player
- Modify hls.js config to use manifest rewriter URL for manifests
- Segment URLs are rewritten to Blob CDN — player fetches directly
- Keep HLS Server as fallback for any issues

### Phase 3: Cut Over
- Route all `/streams/*.m3u8` to manifest rewriter
- Route all `/streams/*.ts` to CDN/Blob Storage
- Scale down HLS Server to 0
- Monitor for issues

### Phase 4: Cleanup
- Remove HLS Server from deployment
- Update Front Door routes
- Update documentation

---

## When NOT to Use Architecture C

- **Events under 1,000 viewers** — Architecture B is simpler and sufficient
- **Strict real-time revocation needed** — SAS tokens have a minutes-long revocation lag
- **Limited development resources** — the auth model rewrite is non-trivial
- **Safari-heavy audience** — test thoroughly; Safari's native HLS handling of SAS URLs needs verification

---

## Further Reading

- [Architecture Overview (README)](./README.md) — Comparison of all three approaches
- [Architecture A — Lift-and-Shift](./architecture-a-lift-and-shift.md) — Zero code changes approach
- [Architecture B — Cloud-Optimized](./architecture-b-cloud-optimized.md) — Recommended starting point
- [Azure Blob Storage SAS documentation](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview)
- [Azure Front Door CDN caching](https://learn.microsoft.com/en-us/azure/frontdoor/front-door-caching)
