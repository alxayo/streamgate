# Multi-DRM Implementation Plan for StreamGate

**Branch:** `DRM` (created from `main`, pushed to `origin/DRM`)  
**Codebase:** `/Users/alex/Code/streamgate`  
**Research Date:** 2026-04-20

---

## Executive Summary

StreamGate is a ticket-gated HLS video streaming platform consisting of a Next.js 16 Platform App (port 3000) and an Express.js HLS Media Server (port 4000). Currently, content protection relies entirely on a **custom JWT-based access control layer** — HMAC-signed tokens validated on every `.m3u8`/`.ts` request. This is *transport-level* protection (who can request the bytes), not *content-level* encryption (what the bytes contain). DRM adds a second, independent layer: the video segments themselves are encrypted, and playback requires a license from a trusted authority regardless of how the bytes were obtained.

To achieve **cross-platform Multi-DRM** (Widevine on Chrome/Firefox/Android, PlayReady on Windows Edge, FairPlay on all Apple devices), StreamGate must:

1. **Re-encode content** using CMAF/CBCS encryption with all three DRM systems signaled simultaneously in the HLS manifest.
2. **Integrate a Multi-DRM License Server** (SaaS provider or self-hosted) that issues Widevine, PlayReady, and FairPlay licenses.
3. **Migrate the browser player from hls.js to Shaka Player** (recommended) or Video.js + contrib-eme (alternative), as hls.js has no EME/DRM support.
4. **Add a License Token endpoint** to the Platform App that bridges the existing JWT session to a short-lived DRM license token accepted by the license server.
5. **Preserve the existing token/session/revocation architecture** — DRM sits alongside it, not replacing it.

The existing `__token` Safari fallback, JWT minting, revocation cache, and heartbeat/refresh flows all remain intact. The largest new dependency is a Multi-DRM SaaS provider; the largest engineering effort is the content-encoding pipeline change and the player migration.

---

## Table of Contents

1. [Current Architecture Deep-Dive](#1-current-architecture-deep-dive)
2. [Why the Current Protection Is Not DRM](#2-why-the-current-protection-is-not-drm)
3. [Multi-DRM Strategy: CMAF + CENC/CBCS](#3-multi-drm-strategy-cmaf--cenccbcs)
4. [Platform and Browser DRM Matrix](#4-platform-and-browser-drm-matrix)
5. [Player Migration: hls.js to Shaka Player](#5-player-migration-hlsjs-to-shaka-player)
6. [DRM License Server Integration](#6-drm-license-server-integration)
7. [How DRM Integrates with Existing JWT Auth](#7-how-drm-integrates-with-existing-jwt-auth)
8. [Content Pipeline Changes](#8-content-pipeline-changes)
9. [HLS Media Server Changes](#9-hls-media-server-changes)
10. [Platform App Changes](#10-platform-app-changes)
11. [Multi-DRM Provider Comparison](#11-multi-drm-provider-comparison)
12. [Implementation Phases](#12-implementation-phases)
13. [Risk Register](#13-risk-register)
14. [Confidence Assessment](#14-confidence-assessment)
15. [Footnotes](#15-footnotes)

---

## 1. Current Architecture Deep-Dive

### 1.1 Services and Ports

| Service | Framework | Port | Directory |
|---------|-----------|------|-----------|
| Platform App | Next.js 16 + Prisma 7 + SQLite | 3000 | `platform/` |
| HLS Media Server | Express.js 4 + TypeScript | 4000 | `hls-server/` |
| Shared Token Library | TypeScript | N/A | `shared/` |

### 1.2 Current Authentication Flow

```
Browser                    Platform App (:3000)           HLS Server (:4000)
   |                              |                              |
   |  POST /api/tokens/validate   |                              |
   |  { code: "ABC123XYZ789" }    |                              |
   |------------------------------>|                              |
   |                              |  DB lookup, session create   |
   |  { playbackToken: <JWT>,     |                              |
   |    streamPath: /streams/... }|                              |
   |<------------------------------|                              |
   |                              |                              |
   |  GET /streams/:eventId/stream.m3u8                          |
   |  Authorization: Bearer <JWT>                                |
   |------------------------------------------------------------->|
   |                              |  [every 30s poll revocations]|
   |                              |<------------------------------|
   |  .m3u8 manifest (plaintext)  |                              |
   |<-------------------------------------------------------------|
   |                              |                              |
   |  GET /streams/:eventId/seg0001.ts (same JWT)                |
   |------------------------------------------------------------->|
   |  plaintext .ts segment       |                              |
   |<-------------------------------------------------------------|
```

### 1.3 Key Files

| File | Purpose |
|------|---------|
| `platform/src/components/player/video-player.tsx` | hls.js player component |
| `platform/src/app/api/tokens/validate/route.ts` | Token validation, JWT minting |
| `platform/src/app/api/playback/refresh/route.ts` | JWT refresh (every 50 min) |
| `platform/src/app/api/revocations/route.ts` | Internal revocation sync endpoint |
| `hls-server/src/middleware/jwt-auth.ts` | JWT verification on every HLS request |
| `hls-server/src/routes/streams.ts` | Stream file serving (local/proxy/cache) |
| `hls-server/src/services/jwt-verifier.ts` | HMAC-SHA256 JWT verification |
| `hls-server/src/services/revocation-cache.ts` | In-memory revocation Map |
| `shared/src/types.ts` | `PlaybackTokenClaims` interface |
| `shared/src/constants.ts` | `JWT_ALGORITHM = 'HS256'`, expiry, rate limits |
| `platform/prisma/schema.prisma` | Event, Token, ActiveSession data model |

### 1.4 JWT Token Claims

```typescript
// shared/src/types.ts lines 1-10
interface PlaybackTokenClaims {
  sub: string;      // Access token code (base62, 12 chars)
  eid: string;      // Event ID (UUID)
  sid: string;      // Active session ID (single-device enforcement)
  sp: string;       // Allowed stream path prefix: "/streams/:eventId/"
  iat: number;      // Issued at
  exp: number;      // 1-hour expiry (JWT_EXPIRY_SECONDS = 3600)
  probe?: boolean;  // HEAD-only probe token
}
```

### 1.5 Current Player Implementation

The player (`platform/src/components/player/video-player.tsx` lines 46-133) uses two paths:

- **Primary path:** `Hls.isSupported()` → hls.js with `xhrSetup` callback injecting `Authorization: Bearer <JWT>` header on every XHR request.[^1]
- **Fallback path:** `supportsNativeHls()` → Native `<video>` with `?__token=<JWT>` query param appended to the src URL.[^1]

The fallback exists for old iOS Safari (< iOS 15) where MSE is unavailable. **This fallback must be reworked for DRM**, as native `<video>` with a query param cannot participate in EME license flows.

**Current hls.js version:** `"hls.js": "^1.6.15"` — hls.js deliberately excludes EME/DRM support by design.[^12]

### 1.6 Content Currently Served

The HLS server allows these file extensions[^6]:
- `.m3u8` — HLS manifests (application/vnd.apple.mpegurl)
- `.ts` — MPEG-TS segments (video/mp2t)
- `.fmp4` — Fragmented MP4 segments (video/mp4)
- `.mp4` — MP4 files (video/mp4)

**There is no encryption today.** Segments are served as raw plaintext bytes. The `UpstreamProxy` simply pipes bytes from origin to client unchanged.[^13]

---

## 2. Why the Current Protection Is Not DRM

The current JWT system is **transport-level access control** — it controls *who can download* the bytes. It does NOT encrypt the content itself. This means:

1. **Capture attack:** A legitimate viewer can use browser devtools, `ffmpeg -i`, or a screen recorder to capture the plaintext `.ts` segments after they pass through the JWT gate. The bytes on disk are unencrypted H.264/H.265.
2. **JWT forwarding:** A viewer could copy the JWT to a second device during the 1-hour validity window. The 30-second revocation poll creates a window where both devices could stream simultaneously.
3. **Cache attack:** The segment cache at `SEGMENT_CACHE_ROOT` stores unencrypted segments permanently. If the cache directory is readable, content is fully recoverable without authentication.
4. **Upstream proxy transparency:** `UpstreamProxy.fetch()` passes bytes unmodified from origin to client — if the upstream origin is reachable, it bypasses access control entirely.

**DRM closes all four gaps.** With DRM, even if someone captures the raw `.ts`/`.fmp4` bytes, they cannot decode the content without a valid license key, which is bound to the device's hardware security module (Widevine L1 / Secure Enclave) and time-limited.

---

## 3. Multi-DRM Strategy: CMAF + CENC/CBCS

### 3.1 The Single-Encryption Problem

Each DRM system historically used a different encryption mode:
- **Widevine / PlayReady** preferred AES-128-CTR (CENC)
- **FairPlay** required AES-128-CBC (CBCS)

This meant creating two separate encrypted copies of every video asset. **CBCS (Common Encryption in CBC Sporadic mode)** was introduced in ISO 23001-7 Amendment 3 and is now supported by all three systems, enabling **one encrypted copy** that works everywhere.

### 3.2 CMAF (Common Media Application Format)

CMAF (ISO 23000-19) defines fragmented MP4 (fMP4) segments that can be delivered over both HLS (`.m3u8`) and DASH (`.mpd`). Key characteristics:

- Segments are `.cmfv` (video) / `.cmfa` (audio) / `.cmft` (timed text), typically served as `.m4s` or `.fmp4`
- Single file set works with both HLS and DASH manifests
- **Replaces MPEG-TS segments** (`.ts`) for encrypted content
- Required for CBCS multi-DRM compatibility — MPEG-TS segments cannot carry CENC/CBCS encryption markers correctly

**Impact on StreamGate:** The current `.ts` segments must be re-encoded as CMAF `.fmp4` segments. The HLS server already supports `.fmp4` in `ALLOWED_EXTENSIONS`[^6] and `MIME_TYPES`[^6], so no server-side MIME changes are needed.

### 3.3 How Multi-DRM Works in HLS Manifests

A CMAF-encrypted HLS manifest signals all three DRM systems using `#EXT-X-SESSION-KEY` tags:

```m3u8
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:6

# Widevine (Chromium-based browsers, Android)
#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,\
  URI="data:text/plain;base64,<widevine_pssh_base64>",\
  KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",\
  KEYFORMATVERSIONS="1"

# PlayReady (Edge on Windows)
#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES-CTR,\
  URI="data:text/plain;base64,<playready_pssh_base64>",\
  KEYFORMAT="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95",\
  KEYFORMATVERSIONS="1"

# FairPlay (Safari on macOS/iOS)
#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,\
  URI="skd://your-keyserver.com/content-id",\
  KEYFORMAT="com.apple.streamingkeydelivery",\
  KEYFORMATVERSIONS="1"

#EXT-X-MAP:URI="init.mp4"
#EXTINF:6.0,
seg001.m4s
#EXTINF:6.0,
seg002.m4s
```

When the player parses this manifest:
- Safari/WebKit looks for `KEYFORMAT="com.apple.streamingkeydelivery"` → FairPlay flow
- Chrome/Firefox looks for Widevine UUID → Widevine flow
- Edge looks for PlayReady UUID → PlayReady flow

### 3.4 Encryption Key Structure

For each content asset:
- One **Content Encryption Key (CEK)** — the AES-128 key used to encrypt the video
- One **Key ID (KID)** — a UUID identifying which key was used
- The CEK is stored by the DRM license server and never transmitted in the manifest
- Each DRM system wraps the CEK in a **Protection System Specific Header (PSSH)** box embedded in the fMP4 init segment and/or manifest

The StreamGate HLS server never needs to know the CEK. The DRM license server handles all key storage and delivery.

---

## 4. Platform and Browser DRM Matrix

### 4.1 Full Platform Coverage

| Platform | Browser | DRM System | Protocol | Security Level |
|----------|---------|------------|----------|----------------|
| Windows 10/11 | Chrome, Firefox | Widevine | EME/CENC | Software (L3) |
| Windows 10/11 | Edge | PlayReady + Widevine | EME/CENC | Hardware (SL3000) on modern devices |
| macOS | Safari | FairPlay | EME/CBCS | Secure Enclave |
| macOS | Chrome, Firefox | Widevine | EME/CENC | Software (L3) |
| iOS / iPadOS | Safari | FairPlay | EME/CBCS | Secure Enclave (required) |
| iOS / iPadOS | Chrome, Firefox | FairPlay | EME/CBCS | All iOS browsers use WebKit engine |
| Android | Chrome | Widevine | EME/CENC | L1 hardware on most devices |
| Android | Firefox, others | Widevine | EME/CENC | L1/L3 depending on device |
| Samsung TV | Tizen | PlayReady or Widevine | EME | Hardware TEE |
| LG TV | webOS | PlayReady or Widevine | EME | Hardware TEE |

### 4.2 Critical iOS Note

On iOS, **FairPlay is mandatory** regardless of the browser used. Chrome for iOS, Firefox for iOS, and all third-party browsers use Apple's WebKit rendering engine. They all route DRM through the FairPlay EME implementation. Widevine is not available in any iOS browser. This is the most common cross-platform DRM oversight.

### 4.3 Widevine Security Levels

| Level | Security | Typical Devices | Content Restriction |
|-------|----------|-----------------|---------------------|
| L1 | Hardware TEE | Android (most), Chromebooks | 1080p/4K allowed |
| L2 | Partial hardware | Some older Android | 1080p restricted |
| L3 | Software only | Desktop Chrome/Firefox, older Android | Usually 540p for premium content |

For a ticket-gated event platform, L3 is typically acceptable. Studios imposing HD restrictions (like Netflix/Disney) require L1, but that is a content licensing constraint, not a technical one.

---

## 5. Player Migration: hls.js to Shaka Player

### 5.1 Why hls.js Cannot Be Used for DRM

hls.js version 1.x (including current `^1.6.15`) explicitly does not support EME (Encrypted Media Extensions). From the hls.js project documentation: "hls.js does not support DRM." This is a deliberate design decision — the library focuses on adaptive bitrate HLS delivery and leaves DRM to the application layer or to native players.

The `xhrSetup` callback used in StreamGate[^1] adds `Authorization: Bearer <JWT>` headers to HLS segment requests — this is unrelated to DRM and will continue to work with any player that supports custom request headers.

### 5.2 Shaka Player Overview

[Shaka Player](https://github.com/shaka-project/shaka-player) (by Google) is an open-source JavaScript media player library supporting:
- HLS and DASH adaptive streaming
- Full EME/DRM support: Widevine, PlayReady, FairPlay, ClearKey
- Custom request filters (equivalent to hls.js `xhrSetup`) for injecting auth headers
- Both MSE-based and native HLS playback paths

**License:** Apache 2.0 (free, no per-stream royalties)

**Current stable version:** 4.x

### 5.3 Shaka Player on Apple Platforms

This is the most nuanced aspect of the migration. Shaka handles Apple platforms in two modes:

#### macOS Safari (10.1+ / Safari 11+)

- macOS Safari supports MSE and EME (including FairPlay via EME API since Safari 12.1 on macOS Mojave).
- Shaka uses its JavaScript MSE/EME path: it fetches HLS segments, demuxes them in JavaScript, feeds them to MSE, and calls the EME API for FairPlay license acquisition.
- **This is the preferred path** — gives full control over ABR, buffering, and license request headers.
- Configuration: `useNativeHlsOnSafari: false` (default in Shaka 4.x for macOS Safari 12.1+)

#### iOS Safari / All iOS Browsers

- iOS Safari added `ManagedMediaSource` (MMS) in iOS 17.1 (September 2023), enabling MSE-like functionality for web video.
- On iOS 15-17.0: Shaka falls back to **native HLS playback** — it sets `video.src` to the `.m3u8` URL and lets WebKit handle playback. Shaka still intercepts the FairPlay license request via the `eme-key-session-request` event.
- On iOS 17.1+: Shaka can use `ManagedMediaSource` for full MSE-path control, enabling adaptive bitrate and segment buffering in JavaScript.
- **DASH is not supported on iOS in native HLS mode** — only HLS manifests work.
- Configuration: `useNativeHlsOnSafari: true` for iOS 15-17.0 compatibility. Shaka 4.x auto-detects this.

#### What "Shaka manages FairPlay even in native mode" means

When Shaka is in native HLS mode on iOS, WebKit still fires `webkitneedkey` (or `encrypted`) events on the `<video>` element when it encounters an `EXT-X-SESSION-KEY` FairPlay tag. Shaka intercepts these events, performs the FairPlay license handshake (fetching the FairPlay certificate and sending the SPC to the license server), and installs the CKC response. The video plays natively but the key exchange is managed by Shaka's DRM module.

### 5.4 Shaka Player Request Filters (Replacing hls.js xhrSetup)

```javascript
// Equivalent of hls.js xhrSetup for Shaka Player
player.getNetworkingEngine().registerRequestFilter((type, request) => {
  // Inject JWT on every HLS segment/manifest request
  if (type === shaka.net.NetworkingEngine.RequestType.SEGMENT ||
      type === shaka.net.NetworkingEngine.RequestType.MANIFEST) {
    request.headers['Authorization'] = `Bearer ${getToken()}`;
  }
  // Inject license token on DRM license requests
  if (type === shaka.net.NetworkingEngine.RequestType.LICENSE) {
    request.headers['X-DRM-Token'] = getDrmLicenseToken();
  }
});
```

This is a direct analog to the current hls.js `xhrSetup`[^1] and preserves the existing JWT-on-every-request behavior.

### 5.5 Alternative: Video.js with contrib-eme

[Video.js](https://videojs.com/) with the [videojs-contrib-eme](https://github.com/videojs/videojs-contrib-eme) plugin is another viable option:

| Aspect | Shaka Player | Video.js + contrib-eme |
|--------|-------------|------------------------|
| License | Apache 2.0 | Apache 2.0 |
| Bundle size | ~500KB (gzipped ~150KB) | Video.js ~200KB + contrib-eme ~30KB |
| DRM support | Native (built-in) | Via plugin |
| HLS support | Built-in | Via videojs-http-streaming |
| DASH support | Built-in | Via videojs-contrib-dash |
| FairPlay iOS | Supported | Supported |
| Active maintenance | Google-backed | Community |
| API complexity | Moderate | Lower |
| Custom UI | Full control needed | Skinnable out-of-box |

**Recommendation: Shaka Player.** It is purpose-built for DRM streaming, Google-maintained, and better integrated. Video.js is better when you want to preserve a skinned UI quickly — but StreamGate has a fully custom UI already[^1], so Shaka's more powerful API is preferable.

### 5.6 Migration Impact on Existing Player Code

The existing `VideoPlayer` component[^1] at `platform/src/components/player/video-player.tsx` must be rewritten:

**What stays the same:**
- `<video>` element with `ref={videoRef}`, `playsInline`, `autoPlay`
- Quality level selection concept (Shaka has `getVariantTracks()`)
- Error handling patterns
- All UI controls (PlayPauseButton, VolumeControl, ProgressBar, etc.) are independent components and unchanged
- Token injection pattern (moves from `xhrSetup` to `registerRequestFilter`)
- `onStreamError` callback

**What changes:**
- `import Hls from 'hls.js'` → `import shaka from 'shaka-player/dist/shaka-player.ui'`
- `new Hls({ xhrSetup })` → `new shaka.Player(video)` + `registerRequestFilter`
- `hls.loadSource(url)` → `player.load(url)`
- `Hls.Events.MANIFEST_PARSED` → `player.addEventListener('trackschanged', ...)`
- `hls.currentLevel = n` → `player.selectVariantTrack(track, true)`
- DRM configuration added via `player.configure({ drm: { ... } })`
- FairPlay certificate pre-loading step (unique to FairPlay, see Section 7)

---

## 6. DRM License Server Integration

### 6.1 What a DRM License Server Does

The DRM license server is a trusted service that:
1. Authenticates the viewer's right to access specific content (via a license token)
2. Wraps the Content Encryption Key (CEK) in the DRM-specific format the device needs:
   - Widevine: protobuf-encoded `LicenseRequest` → `LicenseResponse`
   - PlayReady: SOAP/XML `AcquireLicense` request/response
   - FairPlay: binary SPC (Server Playback Context) → CKC (Content Key Context)
3. Returns the wrapped key material to the player's CDM (Content Decryption Module)
4. The CEK never leaves the TEE (Trusted Execution Environment) of the device

### 6.2 License Request Flow

```
Player (Shaka)             Platform App               DRM License Server
     |                          |                              |
     | Encounters EXT-X-KEY     |                              |
     | in m3u8 manifest         |                              |
     |                          |                              |
     | POST /api/drm/license-token                             |
     | Authorization: Bearer <playback-JWT>                    |
     |-------------------------->|                              |
     |                          | Validate JWT, check session  |
     |                          | Generate short-lived DRM token|
     | { drmToken: "...", ttl }  |                              |
     |<--------------------------|                              |
     |                          |                              |
     | POST <license-server-url>/widevine                       |
     | X-DRM-Token: <drmToken>   |                              |
     | Body: Widevine LicenseRequest (protobuf)                 |
     |------------------------------------------------------------>|
     |                          |                              | Validate drmToken
     |                          |                              | Lookup CEK by KID
     |                          |                              | Wrap in Widevine format
     | Widevine LicenseResponse  |                              |
     |<------------------------------------------------------------|
     |                          |                              |
     | CDM decrypts segments     |                              |
     | Video plays               |                              |
```

### 6.3 Self-Hosted vs SaaS License Server

#### Option A: SaaS Multi-DRM Provider (Recommended)

SaaS providers manage key storage, PSSH generation, license issuance for all three DRM systems, and compliance (Widevine certification, PlayReady certification, FairPlay entitlement from Apple). They provide:
- REST API for content key registration (when encoding content)
- License endpoint URLs (one per DRM system, or a unified endpoint)
- Dashboard for monitoring license issuance
- Token-based authentication for license requests (custom claims in JWT or proprietary token format)

#### Option B: Self-Hosted (e.g., Wowza, ezDRM self-hosted, Bento4/Shaka Packager + custom key server)

Self-hosted requires:
- Signing agreements with Google (Widevine), Microsoft (PlayReady), and Apple (FairPlay)
- Managing encryption keys securely (HSM recommended)
- Implementing all three DRM handshake protocols
- Handling Widevine device certificate chain validation
- **This is months of work and requires legal agreements**. Not recommended unless you have specific compliance reasons.

---

## 7. How DRM Integrates with Existing JWT Auth

### 7.1 Two-Layer Security Model

With DRM added, StreamGate will have **two independent security layers**:

```
Layer 1 (existing): JWT gate on HLS server
  - Controls who can download encrypted bytes
  - In-memory revocation within 30 seconds
  - Single-device enforcement via session ID

Layer 2 (new): DRM license binding
  - Controls who can DECRYPT the downloaded bytes
  - License bound to device CDM hardware
  - License expiry independent of JWT expiry
```

Both layers must be active. Neither alone is sufficient:
- JWT without DRM: content is downloadable in plaintext once JWT is valid
- DRM without JWT: content bytes are encrypted but the manifest is publicly accessible, enabling unauthorized enumeration and caching

### 7.2 New Platform App Endpoint: License Token Proxy

A new endpoint `POST /api/drm/license-token` must be added to the Platform App:

```typescript
// platform/src/app/api/drm/license-token/route.ts (NEW)
export async function POST(request: NextRequest) {
  // 1. Validate existing playback JWT (proves valid session)
  const authHeader = request.headers.get('authorization');
  const jwt = authHeader?.slice(7);
  const claims = await verifyPlaybackToken(jwt); // existing function

  // 2. Validate session is still active in DB
  const session = await prisma.activeSession.findUnique({
    where: { sessionId: claims.sid }
  });
  if (!session) return 401;

  // 3. Generate DRM license token
  //    - Short-lived (5-10 minutes)
  //    - Contains: eventId, contentId, allowed KIDs
  //    - Signed with DRM provider's shared secret OR
  //      sent to DRM provider API to get a token
  const drmToken = await drmProvider.generateLicenseToken({
    contentId: claims.eid,
    sessionId: claims.sid,
    allowedKids: await getContentKeyIds(claims.eid), // from DB or config
    expiresIn: 600, // 10 minutes
  });

  return NextResponse.json({ drmToken, ttl: 600 });
}
```

### 7.3 Revocation Propagation with DRM

The existing revocation system (30-second poll to `/api/revocations`)[^4] still controls HLS segment delivery. For DRM license revocation:

- **Short license TTL approach:** Issue licenses valid for only 5-10 minutes. The player must request a new license every 5-10 minutes. Revoking the session in the Platform DB means the `license-token` endpoint returns 403, and the next license renewal fails. This introduces a max 5-10 minute delay before a revoked viewer loses access — acceptable for most use cases.
- **License server callback approach:** Some providers (Axinom, EZDRM) support calling a Platform webhook before issuing each license. The Platform App can check the session in real-time before approving the license. This achieves near-instant revocation at the cost of a synchronous HTTP call per license request.

**Recommendation:** Use short license TTL (5 minutes) plus the existing JWT gate for immediate denial. The JWT gate already provides sub-30-second revocation for segment delivery.

### 7.4 FairPlay Certificate Pre-Loading

FairPlay requires an additional step: the player must download an **Application Certificate** from the license server before initiating the key exchange. This is a one-time fetch (cacheable), but it means the FairPlay configuration in Shaka must include:

```javascript
player.configure({
  drm: {
    servers: {
      'com.widevine.alpha': 'https://license.provider.com/widevine',
      'com.microsoft.playready': 'https://license.provider.com/playready',
      'com.apple.fps': 'https://license.provider.com/fairplay',
    },
    advanced: {
      'com.apple.fps': {
        serverCertificateUri: 'https://license.provider.com/fairplay/cert',
      }
    }
  }
});
```

The Platform App's `license-token` endpoint provides a token that Shaka injects as a request header on every license request (via `registerRequestFilter`), not just the first one.

### 7.5 Preserving the __token Safari Fallback

The current `__token` query param fallback[^1] for old iOS Safari (< iOS 15) is used because those browsers cannot use `xhrSetup` (MSE unavailable, so hls.js won't load, falling back to native `<video src="...?__token=...">`).

With Shaka Player in native HLS mode on iOS:
- Shaka sets `video.src = url` (the `.m3u8` URL) — the existing `__token` query param approach can still be used for the manifest URL
- But Shaka will intercept the FairPlay EME events and add its own license header logic
- **The `__token` query param on the manifest URL is still needed** because WebKit fetches segments internally and cannot have headers injected by JavaScript in native HLS mode

The HLS server's `jwt-auth.ts` already handles `__token` as a fallback[^5], so no change is needed there.

---

## 8. Content Pipeline Changes

### 8.1 Current vs DRM-Ready Encoding

**Current pipeline (assumed):**
```
Source video -> FFmpeg -> HLS (.ts segments + .m3u8 manifest) -> STREAM_ROOT/:eventId/
```

**DRM-ready pipeline (required):**
```
Source video -> FFmpeg/encoder -> CMAF fMP4 (.m4s segments + init.mp4)
    -> Shaka Packager or similar -> CMAF encrypted with CBCS
       + Widevine PSSH embedded
       + PlayReady PSSH embedded
       + FairPlay key signaling
    -> DRM-signaled .m3u8 manifest
    -> STREAM_ROOT/:eventId/ (replaces .ts with .m4s + init.mp4)
```

### 8.2 Shaka Packager (Content Encryption Tool)

[Shaka Packager](https://github.com/shaka-project/shaka-packager) (open source, Google) is the standard tool for creating CMAF content with Multi-DRM PSSH boxes. Example usage:

```bash
packager \
  'in=video.mp4,stream=video,init_segment=init.mp4,segment_template=seg$Number%05d$.m4s' \
  'in=video.mp4,stream=audio,init_segment=audio_init.mp4,segment_template=audio_seg$Number%05d$.m4s' \
  --protection_scheme cbcs \
  --enable_raw_key_encryption \
  --keys label=video:key_id=<hex_kid>:key=<hex_cek> \
  --pssh_generator_flags widevine_pssh,common_pssh \
  --hls_master_playlist_output master.m3u8 \
  --hls_playlist_type vod
```

The `key_id` and `key=` values are provided by the DRM license server — you register the content first, the server assigns KIDs and CEKs, then you encrypt with those values.

### 8.3 FairPlay Encryption Notes

FairPlay uses a slightly different key structure:
- Content Key: 16-byte AES key
- IV: 16-byte initialization vector  
- Content ID: a URI in the manifest `skd://` scheme that the player sends to the license server

Shaka Packager supports FairPlay encryption via the `--hls_key_uri` flag for the `skd://` URI.

### 8.4 Per-Event Key Management

Each StreamGate event should have:
- One KID (Key ID) registered with the DRM provider
- One CEK (Content Encryption Key) stored only on the DRM provider's key server
- The KID stored in the `Event` model in Prisma (add a `drmKeyId` field)

This allows per-event key rotation (e.g., if an event's content key is compromised, only that event is affected).

**Schema addition required:**
```prisma
model Event {
  // ... existing fields ...
  drmKeyId    String?  // UUID of the content key registered with DRM provider
  drmContentId String? // Content ID for FairPlay skd:// URI
}
```

### 8.5 Live Streaming DRM

For live events, encryption happens at the encoder/packager level in real time:
- The encoder (e.g., FFmpeg, OBS, hardware encoder) outputs CMAF chunks
- An inline packager (e.g., Shaka Packager in live mode, Bitmovin, Elemental) encrypts each chunk as it is produced
- The manifest is updated with new segment references every few seconds
- **Key rotation** in live streams is optional but recommended for long events — rotate keys every 4-8 hours

The HLS server's proxy mode (`UpstreamProxy`) simply proxies the encrypted bytes unchanged — it never needs to know about encryption keys.

---

## 9. HLS Media Server Changes

The HLS Media Server requires **minimal changes** for DRM. Since DRM encryption happens at content creation time and license acquisition happens between the player and the DRM license server (not through the HLS server), the streaming server is largely transparent.

### 9.1 Changes Required

**MIME type addition** — Add `.m4s` (CMAF audio/video segments):

```typescript
// hls-server/src/routes/streams.ts — ADD to MIME_TYPES and ALLOWED_EXTENSIONS
const MIME_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.fmp4': 'video/mp4',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',  // NEW: CMAF segments
  '.key': 'application/octet-stream', // NEW: FairPlay key files (if serving locally)
};

const ALLOWED_EXTENSIONS = new Set(['.m3u8', '.ts', '.fmp4', '.mp4', '.m4s', '.key']); // .m4s added
```

**CORS headers** — DRM license requests come from the same origin as HLS requests, so no CORS changes needed for the HLS server. However, the DRM license server URL must be reachable from the browser (add it to any CSP headers in Next.js).

**No changes needed** to:
- JWT authentication middleware (continues to gate all `.m3u8`/`.m4s`/`.ts` requests)
- Revocation cache
- Upstream proxy (passes encrypted bytes unchanged)
- Segment cache (caches encrypted bytes — fine, they're useless without a license)
- Content resolver

### 9.2 Security Benefit of DRM + Existing Cache

A useful side effect: the segment cache now stores **encrypted** bytes. Even if the `SEGMENT_CACHE_ROOT` directory is accessed by an attacker, the content is unplayable without a DRM license. This closes the cache attack vector identified in Section 2.

---

## 10. Platform App Changes

### 10.1 New Files Required

| File | Purpose |
|------|---------|
| `platform/src/app/api/drm/license-token/route.ts` | New: bridge JWT session to DRM license token |
| `platform/src/lib/drm.ts` | New: DRM provider client (token generation, key lookup) |
| `platform/src/components/player/video-player.tsx` | Modify: replace hls.js with Shaka Player |

### 10.2 Environment Variables to Add

```bash
# Platform App .env additions
DRM_PROVIDER=axinom          # or ezdrm, pallycon, etc.
DRM_PROVIDER_API_URL=https://key-server.axinom.com/api
DRM_PROVIDER_API_KEY=<secret>
DRM_WIDEVINE_LICENSE_URL=https://license.axinom.com/license/widevine
DRM_PLAYREADY_LICENSE_URL=https://license.axinom.com/license/playready
DRM_FAIRPLAY_LICENSE_URL=https://license.axinom.com/license/fairplay
DRM_FAIRPLAY_CERT_URL=https://license.axinom.com/license/fairplay/cert
DRM_LICENSE_TOKEN_TTL_SECONDS=300  # 5-minute license token lifetime
```

### 10.3 Prisma Schema Changes

```prisma
model Event {
  // ... existing fields ...
  drmKeyId     String?  // Key ID (UUID) registered with DRM provider
  drmContentId String?  // Content ID for FairPlay skd:// URI
  isEncrypted  Boolean  @default(false)  // Whether this event uses DRM encryption
}
```

### 10.4 Token Validation Response Changes

The `POST /api/tokens/validate` response[^2] should include DRM configuration for the player:

```typescript
// Addition to existing response in platform/src/app/api/tokens/validate/route.ts
return NextResponse.json({
  // ... existing fields ...
  drm: token.event.isEncrypted ? {
    widevine: { licenseUrl: env.DRM_WIDEVINE_LICENSE_URL },
    playready: { licenseUrl: env.DRM_PLAYREADY_LICENSE_URL },
    fairplay: {
      licenseUrl: env.DRM_FAIRPLAY_LICENSE_URL,
      certUrl: env.DRM_FAIRPLAY_CERT_URL,
    },
  } : null,
});
```

This allows the player to configure DRM only when the event has encrypted content, enabling a graceful rollout where old unencrypted events continue working without DRM.

### 10.5 Admin Console Changes

The admin UI should allow operators to:
- Toggle `isEncrypted` per event
- Display `drmKeyId` (read-only, set during content registration)
- Show DRM status badge in event list

---

## 11. Multi-DRM Provider Comparison

All major providers support the three DRM systems needed (Widevine, PlayReady, FairPlay) and CMAF/CBCS.

| Provider | Pricing Model | Notable Features | FairPlay Setup |
|----------|---------------|-----------------|----------------|
| **Axinom DRM** | Per-license or monthly flat | Strong tokenized licensing, detailed docs, webhook callbacks for license auth | Good docs, standard |
| **EZDRM** | Per-license (~$0.001-0.01) | Simple REST API, widely used, competitive pricing | Well-documented |
| **PallyCon** | Per-license or monthly | Multi-DRM + forensic watermarking, good for premium content | Standard |
| **Nagra / Conax** | Enterprise | Broadcast-grade, conditional access, expensive | Enterprise support |
| **BuyDRM / KeyOS** | Per-license or monthly | Long-established, reliable | Standard |
| **Castlabs** | Monthly SaaS | drmtoday platform, well-integrated with packagers | Excellent |
| **Bitmovin** | Bundled with encoding | Encoding + DRM in one service, simpler pipeline | Via drmtoday |
| **AWS Elemental** | Per-minute encoding | Tight AWS integration, MediaConvert + SPEKE | Standard |

### 11.1 Recommendation for StreamGate

Given StreamGate's architecture (self-hosted, event-driven, ticket-gated):

**Best fit: Axinom DRM or EZDRM**

Reasons:
- Both offer **tokenized license authorization** — you generate a license token on your Platform App and the DRM server validates it without calling back to you, which fits StreamGate's architecture where the Platform App is the authority on session validity.
- Both have straightforward Shaka Player integration examples.
- EZDRM has the simplest API and pay-per-use pricing (good for event-based usage patterns).
- Axinom has better webhook support for real-time license authorization if near-instant revocation is needed.

### 11.2 FairPlay Entitlement

**Critical:** Apple requires developers to apply for a FairPlay Streaming deployment package. This involves:
1. Enrolling in the Apple Developer Program
2. Signing Apple's FairPlay Streaming License Agreement
3. Receiving a private key and application certificate from Apple
4. Registering those with your DRM provider

All major providers handle this process and store your FairPlay credentials on their key server. **Allow 1-2 weeks for Apple's approval process.**

---

## 12. Implementation Phases

### Phase 1: Foundation (2-3 weeks)

1. Sign up for a Multi-DRM SaaS provider (recommend EZDRM for initial testing)
2. Apply for Apple FairPlay Streaming entitlement
3. Set up Shaka Packager locally; test encrypting a sample VOD asset
4. Verify encrypted playback on each target platform using the provider's test player
5. Add `drmKeyId`, `drmContentId`, `isEncrypted` fields to Prisma schema
6. Add DRM env vars to `.env.example`

### Phase 2: Platform App Backend (1-2 weeks)

1. Implement `platform/src/lib/drm.ts` (DRM provider client)
2. Implement `POST /api/drm/license-token/route.ts`
3. Extend `POST /api/tokens/validate` response to include DRM config
4. Extend admin event creation/editing UI to support `isEncrypted` toggle

### Phase 3: Player Migration (2-3 weeks)

1. Replace hls.js with Shaka Player in `package.json`
2. Rewrite `platform/src/components/player/video-player.tsx` using Shaka API
3. Implement `registerRequestFilter` for JWT injection (replacing `xhrSetup`)
4. Implement DRM configuration block in Shaka (Widevine, PlayReady, FairPlay)
5. Implement license token fetch and refresh logic
6. Test on each target platform: Windows Chrome, Windows Edge, macOS Safari, macOS Chrome, iOS Safari, Android Chrome

### Phase 4: HLS Server Updates (< 1 week)

1. Add `.m4s` to `ALLOWED_EXTENSIONS` and `MIME_TYPES` in `streams.ts`
2. Verify CORS headers allow DRM provider license server domain (Next.js CSP)

### Phase 5: Content Pipeline (Ongoing)

1. Establish encrypted encoding workflow for new events
2. Document key registration process with DRM provider
3. For existing unencrypted events: optionally re-encode (the `isEncrypted` flag allows both to coexist)
4. Set up monitoring for license issuance failures

### Phase 6: Live Stream DRM (if applicable)

1. Evaluate live encoder capability (OBS, FFmpeg, hardware)
2. Integrate real-time CMAF encryption via Shaka Packager live mode or cloud encoder
3. Test with a live stream event end-to-end

---

## 13. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| FairPlay Apple approval delay (1-2 weeks) | High | High | Apply immediately; use EZDRM to handle the application |
| iOS < 17 native HLS mode lacks ABR quality switching | Medium | Medium | Accept: for iOS 15-16 use single-bitrate stream until iOS adoption shifts |
| Shaka Player bundle size increase (~300KB over hls.js) | Certain | Low | Use tree-shaking; lazy-load Shaka only on the player screen |
| DRM provider outage blocks license issuance | Low | Critical | License caching in player (Shaka supports license persistence); choose provider with SLA |
| Existing unencrypted events break after player migration | Certain (without care) | High | Shaka supports non-DRM HLS; `isEncrypted=false` events skip DRM config entirely |
| Content key compromise (CEK leaked) | Very Low | Critical | Per-event keys; key rotation; DRM provider manages keys, StreamGate never sees CEK |
| React SSR conflict with Shaka Player | Medium | Medium | Shaka must be loaded client-side only (`'use client'`); wrap in `dynamic(() => import(...), { ssr: false })` |
| CMAF segment caching in HLS server — init.mp4 must be served | Medium | High | Add `init.mp4` and `.m4s` to `ALLOWED_EXTENSIONS`; test CMAF playlist parsing |

---

## 14. Confidence Assessment

| Finding | Confidence | Basis |
|---------|-----------|-------|
| hls.js has no DRM support | **High** | hls.js project documentation and source; confirmed by v1.6.15 package contents |
| Shaka Player works on iOS with native HLS | **High** | Shaka Player official docs, GitHub issues, and widespread production use |
| CMAF/CBCS is the right encryption format | **High** | Industry standard; W3C, Apple HLS spec, and ISO 23001-7 all mandate it for multi-DRM |
| HLS server needs only MIME type addition | **High** | Code review of `streams.ts` confirms it is format-agnostic; encryption is transparent |
| JWT auth layer is fully preserved | **High** | Code review confirms JWT middleware is independent of content format |
| FairPlay requires Apple developer enrollment | **High** | Apple's documented FairPlay Streaming program requirement |
| Shaka bundle size ~500KB | **Medium** | Based on published Shaka 4.x release notes; exact size depends on build configuration |
| EZDRM/Axinom are best fit | **Medium** | Based on public documentation and community reports; actual fit depends on volume and support needs |
| iOS 17.1+ supports ManagedMediaSource | **High** | Apple developer documentation and Shaka changelog |
| License token TTL of 5 minutes is sufficient | **Medium** | Based on Shaka's license renewal behavior; should be tuned based on provider recommendation |

---

## 15. Footnotes

[^1]: `platform/src/components/player/video-player.tsx:46-133` — Current hls.js player with `xhrSetup` for JWT injection and native HLS fallback path.

[^2]: `platform/src/app/api/tokens/validate/route.ts:1-127` — Token validation endpoint: DB lookup, session creation, JWT minting, response with `playbackToken` and `streamPath`.

[^3]: `platform/src/app/api/playback/refresh/route.ts:1-82` — JWT refresh endpoint: verifies current JWT, extracts `sub` (code) and `sid` (sessionId), validates active session, issues new JWT.

[^4]: `platform/src/app/api/revocations/route.ts:1-63` — Revocation sync endpoint: returns individually revoked token codes and event deactivations since a given timestamp.

[^5]: `hls-server/src/middleware/jwt-auth.ts:1-59` — JWT auth middleware: extracts token from `Authorization: Bearer` header or `__token` query param, verifies signature, checks path prefix, checks revocation cache.

[^6]: `hls-server/src/routes/streams.ts:11-18` — `MIME_TYPES` and `ALLOWED_EXTENSIONS` definitions; currently allows `.m3u8`, `.ts`, `.fmp4`, `.mp4`.

[^7]: `hls-server/src/services/jwt-verifier.ts:1-30` — `JwtVerifier.verify()` using `jose` library with HMAC-SHA256; validates path prefix against `sp` claim.

[^8]: `hls-server/src/services/revocation-cache.ts:1-42` — In-memory `Map<string, number>` revocation cache; `isRevoked()`, `add()`, `addBatch()`, `evictOlderThan()`.

[^9]: `shared/src/types.ts:1-10` — `PlaybackTokenClaims` interface with `sub`, `eid`, `sid`, `sp`, `iat`, `exp`, `probe` fields.

[^10]: `shared/src/constants.ts:1-67` — `JWT_ALGORITHM = 'HS256'`, `JWT_EXPIRY_SECONDS = 3600`, rate limits, token code format.

[^11]: `platform/prisma/schema.prisma:1-62` — Prisma schema with `Event`, `Token`, `ActiveSession` models; no DRM fields currently.

[^12]: `platform/package.json:34` — `"hls.js": "^1.6.15"` — current player dependency.

[^13]: `hls-server/src/services/upstream-proxy.ts:1-42` — `UpstreamProxy.fetch()` passes bytes unmodified from upstream origin to client.

