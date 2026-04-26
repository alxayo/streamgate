# Plan: Per-Event Stream Optimization Controls

Expose all latency optimizations from Live-Stream-Latency-Breakdown.md as configurable per-event settings in the StreamGate admin UI, with system-wide defaults and a multi-codec extensible architecture.

## Decisions

- **Settings scope**: Controls are **per event**, not per ABR rendition. Rendition-level tuning stays preset-based for now.
- **Multi-codec**: Each event can transcode to multiple codecs in parallel (H.264 now; AV1/VP9 future). Each codec = separate container + blob sidecar. All registered transcoders receive publish_start; each checks Platform API to see if its codec is enabled for that event.
- **Config delivery**: Transcoder fetches per-event config from a new internal Platform API endpoint on `publish_start` (no rtmp-go hook changes).
- **Defaults**: System-wide editable defaults (admin settings page) + per-event overrides. New events inherit system defaults.
- **Transcoder fallback behavior**: If the Platform API is temporarily unavailable, the transcoder may use a short-lived cached config for that event or fall back to system-wide admin defaults. It must **not** treat `404`/inactive/forbidden responses as eligible for fallback.
- **Player controls**: Admin-only. Stored on Event, returned in token validation API, applied by VideoPlayer component.
- **Renditions**: Preset-based profiles (e.g., "Low Latency 720p+480p", "Full ABR", "Passthrough Only"), not a full rendition editor.
- **Multi-codec master playlist**: The long-term target is a **single viewer-facing master playlist** containing all enabled codecs and renditions. This will be implemented only after the single-codec dynamic config path is stable.

## Phase 0: Contracts, Failure Policy, and Race Fixes

### 0.1 Cross-Repo Contract Definition

Before implementing dynamic config, define a language-neutral contract for stream configuration.

- Create a JSON schema or OpenAPI document for the payload returned by `GET /api/internal/events/:id/stream-config`
- Generate or manually maintain matching models in:
  - Platform TypeScript
  - HLS server TypeScript
  - rtmp-go HLS transcoder Go
- Do **not** rely on a TypeScript-only shared file as the cross-repo contract because the transcoder is a separate Go service

### 0.2 Startup Failure Policy

Define exact transcoder behavior for each config-fetch outcome:

- `200 OK` with valid config: use fetched per-event config
- timeout / network error / `5xx`: use cached config for that event if recent enough, else use system-wide admin defaults
- `404 Not Found`: do not transcode
- `403 Forbidden` / invalid internal auth: do not transcode
- malformed config: log validation error and fall back to system defaults only if the event itself is valid and active

Define operational limits:

- Config fetch timeout: 1-2 seconds max
- Cached config TTL: short-lived, e.g. 5-15 minutes
- Cache key: `eventId`
- Logging must record whether config source was `event`, `cache`, or `system-default`

### 0.3 Publish Start/Stop Correlation Fix (merged with Phase 4.5)

> **Atomic change**: This section and Phase 4.5 describe the same three-file change. They must be implemented, reviewed, and deployed together — not sequentially. Phase 4.5 is retained as a cross-reference only.

Fix the existing stream-key-only stop behavior before adding config-driven startup.

**`streamProcess` struct** (`rtmp-go/azure/hls-transcoder/transcoder.go`): Add `connID string` field.

**`Start()` signature** (`rtmp-go/azure/hls-transcoder/transcoder.go`): Change to `Start(streamKey, connID string)`. Store `connID` on the `streamProcess` at registration time. Idempotency check must remain inside the lock.

**`Stop()` logic** (`rtmp-go/azure/hls-transcoder/transcoder.go`): After acquiring the lock, compare `sp.connID == connID`. If they differ, log a warning and return without killing the process. Do not delete the key from the map. If connIDs match, proceed with existing SIGTERM logic.

> **Deletion-order change**: The current `Stop()` calls `delete(t.streams, streamKey)` immediately after acquiring the lock, before killing the process. The new implementation must check the connID guard **before** deleting the map entry. Pseudocode: `lock → lookup → if connID mismatch: warn + unlock + return → delete from map → unlock → SIGTERM`. This is a behavioral inversion from the current code and must be explicit in the PR.

**`HandleEvent()`** (`rtmp-go/azure/hls-transcoder/handler.go`): Pass `event.ConnID` to both `Start()` and `Stop()`. Log `conn_id` alongside `stream_key` in all branches.

This prevents an old `publish_stop` from killing a newly started transcoder for the same stream key.

### 0.4 Delivery Sequence

Implementation order:

1. Contract and failure policy (0.1, 0.2)
2. Publish start/stop correlation fix (0.3 / 4.5 — single atomic change)
3. Data model + internal API (Phase 1)
4. Admin UI: system defaults then per-event overrides (Phases 2 and 3)
5. Transcoder integration (Phase 4, excluding 4.5 which is already done)
6. Player integration (Phase 5)
7. Multi-codec expansion (Phase 6)

## Phase 1: Data Model & Defaults API

### 1.1 Prisma Schema Changes

**File**: `platform/prisma/schema.prisma`

Add JSON fields to Event model:
- `transcoderConfig Json?` — per-event transcoder overrides (null = use system defaults)
- `playerConfig Json?` — per-event player overrides (null = use system defaults)

Add new SystemSettings model:
- `id String @id @default("default")` — singleton row
- `transcoderDefaults Json` — system-wide transcoder defaults
- `playerDefaults Json` — system-wide player defaults
- `updatedAt DateTime @updatedAt`

Run `npx prisma migrate dev` to generate migration.

### 1.2 Configuration Models

**Files**:
- `shared/src/stream-config.ts` — TypeScript model used by Platform/HLS server
- `shared/src/index.ts` — Add `export * from './stream-config'`
- `shared/src/types.ts` — Extend `TokenValidationResponse` with `playerConfig` field
- `rtmp-go/azure/hls-transcoder/config_types.go` — Go model matching the same schema (see naming note below)
- `docs/contracts/stream-config.schema.json` or equivalent contract source

Define models consumed by transcoder, player, and admin UI from the shared contract:

**TranscoderConfig** (TypeScript) / **EventTranscoderConfig** (Go):

> **Naming**: The existing Go codebase already has a `TranscoderConfig` struct in `transcoder.go` that holds infrastructure config (`HLSDir`, `RTMPHost`, etc.). The new stream-quality config type must use a distinct name in Go: `EventTranscoderConfig`. The TypeScript type remains `TranscoderConfig` since there is no collision in the TS codebase.

- `codecs: ('h264')[]` — enabled codecs (extensible to 'av1', 'vp9')
- `profile: string` — preset name: 'low-latency-720p-480p' | 'full-abr-1080p-720p-480p' | 'passthrough-only' | 'low-latency-1080p-720p-480p'
- `hlsTime: number` — segment duration in seconds (default: 2)
- `hlsListSize: number` — playlist window segment count (default: 6)
- `forceKeyFrameInterval: number` — seconds between forced keyframes (default: 2)
- `h264: { tune: 'zerolatency' | 'none', preset: 'ultrafast' | 'superfast' | 'veryfast' }`
- `av1?: { preset: number, fastDecode: boolean }` — future, optional
- `vp9?: { deadline: 'realtime' | 'good', cpuUsed: number }` — future, optional

**PlayerConfig**:
- `liveSyncDurationCount: number` (default: 2)
- `liveMaxLatencyDurationCount: number` (default: 4)
- `backBufferLength: number` (default: 0, seconds of played content to keep; -1 for Infinity)
- `lowLatencyMode: boolean` (default: true — applied only when `isLive === true`; see Phase 5.1)

> **hls.js property mapping**: The `backBufferLength` field name matches the hls.js v1 config key directly. The old `liveBackBufferLength` was deprecated in hls.js v1 and is silently ignored. Accepted values: any number ≥ 0 (seconds of played content to retain), or -1 (maps to `Infinity` in the hls.js constructor, meaning no eviction). The VideoPlayer component must map `-1` → `Infinity` before passing to the Hls constructor.

**Merge semantics (decision: full sub-object)**: When an event overrides any field within a nested block (e.g. `h264`), the entire block is stored in `transcoderConfig`. Merge logic is a shallow spread per top-level key:
```ts
// In stream-config endpoint merge logic:
const merged = {
  ...systemDefaults.transcoder,
  ...eventOverrides.transcoder,
  h264: { ...systemDefaults.transcoder.h264, ...(eventOverrides.transcoder?.h264 ?? {}) },
  av1:  { ...systemDefaults.transcoder.av1,  ...(eventOverrides.transcoder?.av1  ?? {}) },
  vp9:  { ...systemDefaults.transcoder.vp9,  ...(eventOverrides.transcoder?.vp9  ?? {}) },
};
```
The admin UI always pre-fills all sub-object fields from current effective defaults before saving, so the DB never holds partial `h264` blocks. This avoids deep recursive merge complexity. Any new codec sub-object follows the same pattern.

**Merge utility location**: Extract the merge logic into `platform/src/lib/stream-config.ts` as a shared function:
```ts
export function mergeStreamConfig(
  systemDefaults: { transcoder: TranscoderConfig; player: PlayerConfig },
  eventOverrides: { transcoder?: Partial<TranscoderConfig>; player?: Partial<PlayerConfig> } | null
): { transcoder: TranscoderConfig; player: PlayerConfig }
```
This function is called from three places: the internal stream-config API (§1.3), the token validation route (§1.4), and the admin event detail page (§3.2). It lives in `platform/src/lib/` (not in the `shared/` package) because it depends on Prisma types and is only used server-side.

**RenderProfile** (each preset maps to a fixed rendition list):
- Define the map in both repos:
  - **TypeScript**: `shared/src/stream-config.ts` — exported `RENDER_PROFILES` constant
  - **Go**: `rtmp-go/azure/hls-transcoder/config_types.go` — `RenderProfiles` map
  - Both must stay in sync; the JSON schema (§0.1) is the source of truth
- Shape: profile name → array of `{ label, width, height, videoBitrate, audioBitrate, mode: 'copy'|'transcode' }`
- Example: `'full-abr-1080p-720p-480p'` → [1080p copy, 720p@2.5Mbps, 480p@1Mbps]
- Example: `'low-latency-720p-480p'` → [720p@2.5Mbps, 480p@1Mbps] (no copy passthrough — all transcoded with forced keyframes)
- Example: `'passthrough-only'` → [copy mode, single rendition]

### 1.3 Internal API: Stream Config Endpoint

**File**: `platform/src/app/api/internal/events/[id]/stream-config/route.ts` (new)

`GET /api/internal/events/:id/stream-config`
- Auth: `X-Internal-Api-Key` header (same as revocation endpoint)
- **Auth import**: Use `import { env } from '@/lib/env'` and check `env.INTERNAL_API_KEY` (typed, throws on missing env var). Do **not** use `process.env.INTERNAL_API_KEY` directly — the revocations route does this but it's a bug (undefined-match bypass when unset). All new internal endpoints must use the `env` module.
- If event doesn't exist or `isActive === false`: respond `404` (transcoder must not start)
- Apply merge via `mergeStreamConfig()` from `platform/src/lib/stream-config.ts` (see §1.2 for semantics)
- **Bootstrap guard**: Use `prisma.systemSettings.upsert({ where: { id: 'default' }, create: hardcodedDefaults, update: {} })` to ensure SystemSettings always exists. Never throw on missing row — return hardcoded defaults instead. The same guard applies in `GET /api/admin/settings`.
- Response shape:
  ```json
  {
    "eventId": "uuid",
    "eventActive": true,
    "configSource": "event | system-default",
    "transcoder": { /* merged TranscoderConfig */ },
    "player": { /* merged PlayerConfig */ }
  }
  ```
- `configSource` is `"event"` when the event has a non-null `transcoderConfig`, otherwise `"system-default"`. This is for transcoder log observability only — the transcoder does not use this field for any logic.

> **`configSource` vs transcoder log `config_source`**: The API response `configSource` has two values (`event`, `system-default`). The transcoder’s log field `config_source` has four values (`event`, `event-cache`, `system-default`, `hardcoded`) because it includes fallback states the API never sees. These are intentionally separate — do not attempt to unify them.

- **`configVersion` is intentionally absent**: Cache TTL is wall-clock-based on the transcoder side; the field adds no value and would imply version-based invalidation semantics that are not implemented.

### 1.3b Internal API: System Defaults Endpoint

**File**: `platform/src/app/api/internal/stream-config/defaults/route.ts` (new)

`GET /api/internal/stream-config/defaults`
- Auth: `X-Internal-Api-Key` header (same as revocation and stream-config endpoints)
- Purpose: Allows the transcoder to cache system-wide defaults at startup and refresh periodically, independent of per-event fetches
- Uses the same upsert bootstrap guard as §1.3 (never 500 on missing row)
- Response shape:
  ```json
  {
    "transcoder": { /* SystemSettings.transcoderDefaults */ },
    "player": { /* SystemSettings.playerDefaults */ }
  }
  ```
- No event-specific data. No merge logic — returns raw system defaults.
- If the SystemSettings row doesn’t exist, upsert with hardcoded defaults and return those.

### 1.4 Extend Token Validation Response

**File**: `platform/src/app/api/tokens/validate/route.ts`

Add `playerConfig` to the response payload returned from `/api/tokens/validate`:
- Fetch event's merged player config (using `mergeStreamConfig()` from `platform/src/lib/stream-config.ts`)
- Include as `playerConfig: { liveSyncDurationCount, liveMaxLatencyDurationCount, backBufferLength, lowLatencyMode }`

> **Optionality**: The `playerConfig` field on `TokenValidationResponse` must be optional (`playerConfig?: PlayerConfig`) because the `shared` package is consumed by the HLS server, which does not use this field. Making it required would break type expectations during rollout. The VideoPlayer component must handle `undefined` by falling back to hardcoded defaults (the same values currently in the codebase: `liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6, lowLatencyMode: isLive`). See §5.1 for the fallback pattern.

> **Not in refresh flow**: `playerConfig` is returned only from `/api/tokens/validate` (initial validation), not from `/api/playback/refresh`. The refresh endpoint returns only `{ playbackToken, tokenExpiresIn }` — it swaps the JWT without re-initializing the player. Config is set once per session; changes take effect on next page load. Do not add `playerConfig` to `TokenRefreshResponse`.

### 1.5 Seed System Defaults

**File**: `platform/prisma/seed.ts` or a migration script

Insert singleton SystemSettings row with optimal H.264 low-latency defaults:
- Transcoder: `{ codecs: ['h264'], profile: 'full-abr-1080p-720p-480p', hlsTime: 2, hlsListSize: 6, forceKeyFrameInterval: 2, h264: { tune: 'zerolatency', preset: 'ultrafast' } }`
- Player: `{ liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 4, backBufferLength: 0, lowLatencyMode: true }`

> **`hlsTime: 2` rationale**: The existing transcoder code uses `-hls_time 3` with a comment noting buffer margin for the SMB write → sidecar poll → blob upload pipeline. That concern applies only to file output mode (legacy). HTTP output mode streams segments directly to the blob sidecar with no SMB intermediary, so the 3-second margin is unnecessary. The 2-second default optimizes for latency in the HTTP pipeline. File-mode deployments that still use SMB should override to `hlsTime: 3` via the admin settings page.

> **Bootstrap guard**: `npx prisma db seed` does NOT run automatically on `prisma migrate dev`. Document the required post-migration step. Additionally, the API routes for both `GET /api/admin/settings` and `GET /api/internal/events/:id/stream-config` must use upsert-or-return-hardcoded-defaults logic (§1.3) so that a missing DB row never causes a 500. The hardcoded TypeScript constant that matches the seed values must be co-located with the route files and tested.

### 1.6 Default Inheritance Rules

Define explicit inheritance semantics:

- New events start with `null` overrides and inherit from `SystemSettings`
- Per-event overrides are stored only for values the admin changed
- The effective config shown in the UI is always computed server-side
- If system defaults change, inherited events pick up the new values automatically
- If an event has explicit overrides, only those fields remain pinned

---

## Phase 2: Admin UI — System Defaults Page

### 2.1 Admin Settings API Routes

**File**: `platform/src/app/api/admin/settings/route.ts` (new)

- `GET /api/admin/settings` — return current SystemSettings (uses upsert bootstrap guard; see §1.5)
- `PUT /api/admin/settings` — update system-wide defaults (validate ranges)
- **Auth**: Session cookie — same middleware as all existing `/api/admin/*` routes. The existing middleware matcher `['/admin/:path*', '/api/admin/:path*']` already covers this route.

### 2.2 Admin Settings Page

**File**: `platform/src/app/admin/settings/page.tsx` (new)

Two-section form:

**Transcoder Defaults section:**
- Codec selection: checkbox group (H.264 checked+disabled for now; AV1, VP9 shown as "coming soon" disabled)
- Rendition profile: dropdown with preset names + description of what each includes
- Segment duration (`hlsTime`): number input, 1–10s, with tooltip: "Duration of each HLS segment. Lower values reduce latency but increase request overhead. 2s recommended for low latency."
- Playlist window (`hlsListSize`): number input, 3–20, tooltip: "Number of segments in the live playlist. 6 segments = hlsTime × 6 seconds of rewind buffer."
- Keyframe interval (`forceKeyFrameInterval`): number input, 1–10s, tooltip: "Seconds between forced keyframes. Must be ≤ segment duration for clean segment boundaries. Lower = better seeking but larger file sizes."
- H.264 tune: toggle for `zerolatency`, tooltip: "Disables B-frames and reduces encoder buffering. Adds ~5% to bitrate but shaves ~0.5s encoding latency. Note: has no effect on copy/passthrough renditions (e.g., 1080p in Full ABR profile). Only applies to transcoded renditions."
- H.264 preset: dropdown (ultrafast/superfast/veryfast), tooltip: "Encoding speed vs compression. ultrafast = lowest latency + CPU, worst compression. veryfast = better quality, higher CPU. Only applies to transcoded renditions."

**Player Defaults section:**
- Live sync duration count: number, 1–10, tooltip: "How many segments behind the live edge the player targets. Lower = closer to real-time, higher rebuffer risk. 2 recommended for low latency."
- Live max latency duration count: number, 2–20, tooltip: "Maximum segments behind live edge before forced catch-up. Set to 2× liveSyncDurationCount."
- Live back buffer length (`backBufferLength`): number input, ≥ 0 or -1, tooltip: "Seconds of played content to keep in buffer. 0 = discard immediately (saves memory). -1 = keep all (Infinity). Positive values (e.g., 30) keep that many seconds of rewind buffer."
- Low latency mode: toggle, tooltip: "Enables hls.js low-latency optimizations. Currently requires LL-HLS server-side support for full effect; still beneficial for aggressive live edge seeking."

### 2.3 Navigation

Add "Settings" link to admin sidebar/nav, alongside existing "Events" link.

### 2.4 Config Source Visibility

Show where effective values come from in the admin UI:

- `System default` — field inherited from SystemSettings
- `Event override` — field explicitly set on this event

> **Transcoder-side config source** (`event-cache`, `system-default`, `hardcoded`) is only visible in transcoder logs. The platform has no mechanism to query the transcoder’s runtime config state. A future transcoder status reporting endpoint would be needed to surface this in the admin UI; that is out of scope for this plan.

---

## Phase 3: Admin UI — Per-Event Advanced Settings

### 3.1 Event Form Enhancement

**File**: `platform/src/components/admin/event-form.tsx`

Add collapsible "Advanced Stream Settings" section below existing fields (collapsed by default). Only shown for `streamType: LIVE`.

Because the current event form is simple, build this as a dedicated subcomponent rather than expanding the existing flat form state inline.

Each control shows:
- Current value (from event override or "Using default: X")
- Toggle to override vs use system default
- Same tooltip explanations as the settings page
- Visual indicator when a value differs from system default

Controls mirror Phase 2.2 fields but with an "inherit from default" option per field.

This section is **per event**, not per rendition stream. Presets control the ABR ladder shape.

### 3.2 Event Detail Page Enhancement

**File**: `platform/src/app/admin/events/[id]/page.tsx`

Add "Stream Configuration" card showing the effective (merged) config for the event, with badges indicating "Default" vs "Custom" per field. Link to edit page to change.

### 3.3 API Validation

**Files**: `platform/src/app/api/admin/events/route.ts`, `platform/src/app/api/admin/events/[id]/route.ts`

Add validation for `transcoderConfig` and `playerConfig` in POST and PUT handlers:
- Validate field ranges (hlsTime 1-10, liveSyncDurationCount 1-10, backBufferLength ≥ -1, etc.)
- Validate profile name is a known preset
- Validate codec names are from allowed list
- Reject unknown fields (defense against storing arbitrary JSON)

**Validation approach**: Extract validation into `platform/src/lib/stream-config.ts` alongside the merge utility:
```ts
export function validateTranscoderConfig(config: unknown): { valid: boolean; errors: string[] }
export function validatePlayerConfig(config: unknown): { valid: boolean; errors: string[] }
```
Use manual checks (consistent with all existing validation in the codebase — no Zod). Both the admin events routes and the admin settings PUT route call these functions. Each function validates the full shape: type checks on every field, range checks, known-enum checks, and rejects unknown top-level keys via `Object.keys()` allowlist comparison. Expected size: ~50 lines per function. If this becomes unwieldy during implementation, introduce Zod as a follow-up refactor — do not block the initial implementation on a new dependency.

---

## Phase 4: Transcoder Integration

### 4.1 Config Fetcher in Transcoder

**File**: `rtmp-go/azure/hls-transcoder/config_fetcher.go` (new)

New component. Two responsibilities:

**Constructor wiring**: The `Transcoder` struct gets a new `configFetcher *ConfigFetcher` field, set in the `NewTranscoder()` constructor. The `ConfigFetcher` is created in `main.go` from the new CLI flags (`-platform-url`, `-platform-api-key`, `-config-cache-ttl`, `-config-fetch-timeout`) and passed to `NewTranscoder()`. This keeps the fetcher at process-lifetime scope — it is not recreated per stream.

**A. System defaults cache** (fetched at startup, refreshed every `configCacheTTL`):
- On startup, call `GET {platformURL}/api/internal/stream-config/defaults` (new endpoint, auth via `X-Internal-Api-Key`)
- Store in `ConfigFetcher.systemDefaults` field (protected by its own `sync.RWMutex`)
- Refresh loop runs independently of stream-specific config fetches
- Before the first successful fetch, use the hardcoded Go struct constants (same values as the TypeScript seed defaults)

**B. Per-event config fetch** (on each `publish_start`):
- Extract event ID from stream key (see stream key format below)
- Perform `GET {platformURL}/api/internal/events/{eventId}/stream-config` outside the process-registry lock

**Stream key format contract**: The RTMP ingest uses stream keys in the format `live/{eventId}` where `eventId` is a UUID. The config fetcher extracts the event ID by splitting on `/` and taking the last segment (matching the existing `buildHTTPOutputPath` logic). If the stream key contains no `/`, the entire key is treated as the event ID. Keys that produce an empty event ID after extraction must be rejected with an error log.
- Four-tier fallback chain (in order):
  1. `200 OK` with valid config → use event config, update event cache entry
  2. timeout / network error / `5xx` with a cached event entry that is still within TTL → use cached event config
  3. timeout / network error / `5xx` with no valid cache → use `systemDefaults` from the system defaults cache (tier A above)
  4. Hard failure before system defaults are available → use hardcoded Go struct constants, log a warning
- `404` → return error, caller must not start FFmpeg
- `403` → return error, caller must not start FFmpeg
- Log `config_source` field (`event`, `event-cache`, `system-default`, `hardcoded`) on every start

> **`config_source` is a log-only field** with four possible values. It is distinct from the API response’s `configSource` field which has only two values. See §1.3 for details.

**Locking strategy for `Transcoder.Start()`**:
1. Acquire lock, check idempotency, release lock immediately (no I/O inside lock)
2. Call `configFetcher.Fetch(eventID)` — no lock held
3. If fetch returns an error (404, 403): log and return, do not proceed
4. Acquire lock again
5. Re-check idempotency (a second `publish_start` may have won the race)
6. Build FFmpeg args, call `cmd.Start()`, register `streamProcess`, release lock

This prevents network latency from serializing concurrent stream starts.

### 4.2 Dynamic FFmpeg Arg Builder

**File**: `rtmp-go/azure/hls-transcoder/transcoder.go`

Refactor `buildABRArgsHTTP` and `buildCopyArgsHTTP` to accept a config struct instead of using hardcoded values:
- `hlsTime` → `-hls_time {value}`
- `hlsListSize` → `-hls_list_size {value}`
- `forceKeyFrameInterval` → `-force_key_frames "expr:gte(t,n_forced*{value})"`
- `h264.tune` → `-tune zerolatency` (or omit)
- `h264.preset` → `-preset {value}`
- Profile name → select which renditions to include (resolve from profile map)

Keep H.264 as the first implementation target. Do not couple this refactor to AV1/VP9-specific FFmpeg argument work.

The existing `buildABRArgs` / `buildCopyArgs` (file output) should also be updated for consistency but lower priority.

> **Master playlist upload**: The existing `uploadMasterPlaylist()` goroutine (HTTP+ABR mode) uploads a static master.m3u8 listing three renditions. When profiles change the rendition count (e.g., `passthrough-only` = 1, `low-latency-720p-480p` = 2, `full-abr` = 3), this goroutine must generate the master playlist content from the resolved profile’s rendition list, not from a hardcoded template. The config struct passed to the arg builder should also be available to the master playlist generator.

> **Path-preservation constraint**: FFmpeg output paths must be identical to the current implementation. Do **not** add a codec prefix, subdirectory, or any other path change in this phase. The flat layout `{eventId}/stream_0/`, `{eventId}/stream_1/`, `{eventId}/master.m3u8` must remain unchanged. Path changes are a Phase 6 concern and require coordinated HLS server updates.

### 4.3 Codec Self-Identification

**File**: `rtmp-go/azure/hls-transcoder/main.go`

Add `-codec h264` CLI flag. On `publish_start`:
1. Fetch config from Platform API (via `t.configFetcher.Fetch(eventID)`)
2. Check if `config.codecs` includes this transcoder's codec
3. If not, log "codec h264 not enabled for event {id}, skipping" and return
4. If yes, build FFmpeg args from config and start

**Where the codec check lives**: The codec self-filter happens inside `Transcoder.Start()`, after the config fetch but before building FFmpeg args. The transcoder's own codec identity is stored on `TranscoderConfig.Codec` (populated from the `-codec` CLI flag in `main.go`). This keeps the check close to the config fetch result and avoids duplicating codec awareness in the handler.

This enables the multi-transcoder fan-out: all transcoders receive all webhooks, each self-filters.

In the initial milestone, only the H.264 transcoder is deployed. Multi-codec fan-out remains behind a later milestone.

### 4.4 New CLI Flags

Add to `rtmp-go/azure/hls-transcoder/main.go`:
- `-platform-url` (required for config fetch)
- `-platform-api-key` (required for config fetch)
- `-codec` (default: "h264")
- `-config-cache-ttl` (default: 10m — applies to both event-level and system-defaults cache)
- `-config-fetch-timeout` (default: 2s)

**Startup validation**: If `-platform-url` or `-platform-api-key` are empty, the transcoder must exit immediately with a clear error message (same fail-fast pattern as the existing `-output-mode` validation). The transcoder cannot operate without config fetch capability — the four-tier fallback chain in §4.1 assumes the fetcher is configured.

> **Do not add `-fallback-hls-time` or `-fallback-hls-list-size`.** These flags were considered but removed because they create a second source of truth that conflicts with the admin-managed system defaults in the Platform DB. The four-tier fallback chain in §4.1 already handles all failure modes. Static fallback values are embedded as Go constants in `config_fetcher.go` alongside the TypeScript seed values — they are not runtime-configurable.

### 4.5 Start/Stop Correlation Update

> **This is implemented in Phase 0.3.** See §0.3 for the complete specification. This entry is retained as a cross-reference only.

Files affected: `rtmp-go/azure/hls-transcoder/handler.go`, `rtmp-go/azure/hls-transcoder/transcoder.go`. Must be shipped as a single atomic change with the Phase 0.3 work — not separately.

### 4.6 Deployment Update

**File**: `rtmp-go/azure/transcoder-colocated.yaml`

Add new CLI args to transcoder container command:
- `-platform-url http://streamgate-platform.internal:3000`
- `-platform-api-key {secret-ref}` — add the value to the `configuration.secrets` array (same pattern as `rtmp-auth-token`), then pass the value directly as a CLI arg in the `command` array. The current YAML hardcodes secret values in both places — follow the same pattern for consistency.
- `-codec h264`
- Omit `-config-cache-ttl` and `-config-fetch-timeout` (use defaults: 10m and 2s)

---

## Phase 5: Player Integration

### 5.1 VideoPlayer Component

**File**: `platform/src/components/player/video-player.tsx`

Change hls.js initialization (currently hardcoded at ~line 70):
- Accept `playerConfig` prop (type `PlayerConfig | undefined`)
- **Fallback for missing config**: If `playerConfig` is `undefined` (e.g., during rollout before the API returns it), fall back to hardcoded defaults:
  ```ts
  const effectiveConfig: PlayerConfig = playerConfig ?? {
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 6,
    backBufferLength: 0,
    lowLatencyMode: true,
  };
  ```
- Compute an effective config from `effectiveConfig` + `isLive`
- The following settings are **live-only** and must be omitted from the Hls constructor when `isLive === false`:
  - `liveSyncDurationCount`
  - `liveMaxLatencyDurationCount`
  - `backBufferLength`
  - `lowLatencyMode` — this is a constructor-level flag; for VOD it has no benefit and may cause unexpected seek behavior. Always pass `lowLatencyMode: false` when `isLive === false`, regardless of what `playerConfig.lowLatencyMode` contains.
- Apply remaining universal settings (e.g., custom buffer sizes if added in future) unconditionally
- **`backBufferLength` mapping**: The `PlayerConfig.backBufferLength` field uses `-1` to represent "keep all" (Infinity). The VideoPlayer must map this before passing to hls.js:
  ```ts
  const hlsBackBuffer = playerConfig.backBufferLength === -1
    ? Infinity
    : playerConfig.backBufferLength;
  ```
- Spread pattern:
  ```ts
  const hlsConfig = {
    enableWorker: true,
    ...(isLive && {
      lowLatencyMode: playerConfig.lowLatencyMode,
      liveSyncDurationCount: playerConfig.liveSyncDurationCount,
      liveMaxLatencyDurationCount: playerConfig.liveMaxLatencyDurationCount,
      backBufferLength: hlsBackBuffer,
    }),
  };
  ```
- Remove hardcoded `liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 6`
- **Native HLS fallback (Safari without MSE)**: All `PlayerConfig` settings are hls.js-specific and have no effect on native `<video>` HLS playback. The native fallback path (`video.src = streamUrl`) should add a code comment: `// PlayerConfig settings are hls.js-only; native HLS has no tuning knobs`. No behavioral change needed for native path.

> **`useEffect` dependency**: The current `useEffect` for hls.js init depends on `[streamUrl, isLive]`. Adding `playerConfig` as a prop would cause hls.js teardown/recreate on every re-render if the object reference is unstable. The `PlayerScreen` parent must memoize the config: `const memoizedConfig = useMemo(() => data.playerConfig, [data.playerConfig])`. Alternatively, the VideoPlayer can destructure individual primitive values from the config and use those as deps. Either approach prevents unnecessary hls.js reinstantiation.

### 5.2 PlayerScreen / Token Validation Flow

**File**: `platform/src/components/viewer/player-screen.tsx`

- Read `playerConfig` from token validation response (`response.data.playerConfig`)
- Pass as prop to `VideoPlayer`

### 5.3 Type Updates

**File**: `platform/src/app/api/tokens/validate/route.ts`

- Add `playerConfig` to the `TokenValidationResponse` type
- Fetch from merged event config (event override + system defaults)

---

## Phase 6: Multi-Codec Architecture (Extensible, After H.264 Dynamic Config Is Stable)

### 6.1 Blob Storage Path Convention

Document (and enforce in blob sidecar) the path layout for multi-codec:
- Single codec (current): `{eventId}/stream_0/`, `{eventId}/stream_1/`, `{eventId}/master.m3u8`
- Multi-codec (future): `{eventId}/h264/stream_0/`, `{eventId}/av1/stream_0/`, `{eventId}/master.m3u8` (dynamic)

For now, H.264-only events continue using the current flat layout. The multi-codec path layout activates when `codecs.length > 1`.

Add an explicit migration plan:

- Existing H.264-only events continue using flat paths
- Unified multi-codec events use codec-prefixed paths
- HLS server must support both layouts during migration

### 6.2 HLS Server Dynamic Master Playlist

**File**: `hls-server/src/routes/streams.ts`

Enhance the existing dynamic master.m3u8 fallback logic:
- Currently probes for `stream_N/` directories
- Add: also probe for `h264/`, `av1/`, `vp9/` codec directories
- If codec directories found, generate a unified multi-codec master with:
  - `CODECS` attribute per variant
  - accurate bandwidth/resolution metadata
  - codec-aware variant paths
- Support both legacy flat layout and new codec-prefixed layout during rollout
- This work is a later milestone, after single-codec dynamic config is proven in production

### 6.3 Adding a New Codec Transcoder (Documentation)

Document the pattern in a new `azure/ADDING-CODEC-TRANSCODER.md`:
1. Copy `hls-transcoder/` → new directory (e.g., `av1-transcoder/`)
2. Replace FFmpeg args for new codec (reference codec compatibility table from latency doc)
3. Build image, deploy as new Container App with `-codec av1`
4. Register webhook in RTMP server: add `-hook-webhook publish_start=http://av1-transcoder:8090/events`
5. Enable codec in admin UI (update allowed codecs list)
6. Blob sidecar is codec-agnostic — reuse same image

---

## Relevant Files

**Platform (Prisma/DB)**:
- `platform/prisma/schema.prisma` — Add `transcoderConfig`, `playerConfig` to Event; add `SystemSettings` model

**Platform (API)**:
- `platform/src/app/api/internal/events/[id]/stream-config/route.ts` — New internal event config endpoint
- `platform/src/app/api/internal/stream-config/defaults/route.ts` — New internal system defaults endpoint (for transcoder startup cache)
- `platform/src/app/api/admin/settings/route.ts` — New system defaults CRUD (admin-facing)
- `platform/src/app/api/admin/events/route.ts` — Add validation for config fields (POST)
- `platform/src/app/api/admin/events/[id]/route.ts` — Add validation for config fields (PUT)
- `platform/src/app/api/tokens/validate/route.ts` — Add `playerConfig` to response
- `platform/src/lib/stream-config.ts` — Config merge utility (`mergeStreamConfig`) + validation functions

**Platform (Admin UI)**:
- `platform/src/components/admin/event-form.tsx` — Add advanced settings section
- `platform/src/app/admin/settings/page.tsx` — New system defaults page
- `platform/src/app/admin/events/[id]/page.tsx` — Show effective stream config

**Platform (Player)**:
- `platform/src/components/player/video-player.tsx` — Accept playerConfig prop, remove hardcoded values
- `platform/src/components/viewer/player-screen.tsx` — Pass playerConfig from API response

**Shared Types**:
- `shared/src/stream-config.ts` — TranscoderConfig, PlayerConfig, RenderProfile types (new file)
- `shared/src/index.ts` — Add `export * from './stream-config'`
- `shared/src/types.ts` — Extend `TokenValidationResponse` with `playerConfig: PlayerConfig` field

**Transcoder (Go)** — files in `rtmp-go` repo, not `streamgate`:
- `rtmp-go/azure/hls-transcoder/main.go` — New CLI flags: -platform-url, -platform-api-key, -codec
- `rtmp-go/azure/hls-transcoder/config_fetcher.go` — New: fetch per-event config from Platform API
- `rtmp-go/azure/hls-transcoder/config_types.go` — New: `EventTranscoderConfig`, `EventPlayerConfig`, `RenderProfiles` map (Go equivalents of TS models)
- `rtmp-go/azure/hls-transcoder/transcoder.go` — Refactor FFmpeg arg builders to use config struct

**Deployment**:
- `rtmp-go/azure/transcoder-colocated.yaml` — Add new CLI args to transcoder container

**HLS Server**:
- `hls-server/src/routes/streams.ts` — Enhance dynamic master.m3u8 for future multi-codec probing

---

## Verification

1. **Contract validation**: Validate the stream-config payload against the shared schema from both Platform TS and transcoder Go
2. **Schema migration**: Run `npx prisma migrate dev`, verify Event model has new JSON fields, SystemSettings table created with seed data
3. **System defaults API**: `curl -X GET /api/admin/settings` returns seeded defaults; PUT updates them; GET reflects changes
4. **Per-event config**: Create event with custom `transcoderConfig` via admin UI, verify `GET /api/internal/events/:id/stream-config` returns merged config (event overrides on top of system defaults)
5. **Fallback behavior**:
  - simulate Platform API timeout → transcoder uses cached config if present
  - simulate API `5xx` with no cache → transcoder uses system defaults
  - simulate API `404` / inactive → transcoder does not start
6. **Start/stop race**: publish, disconnect, and rapidly republish the same event; verify the old `publish_stop` does not kill the new transcoder instance
7. **Transcoder config fetch**: Start transcoder with `-platform-url` flag, trigger publish_start, verify logs show config source (`event`, `cache`, or `system-default`) and FFmpeg args match
8. **Player config**: Validate token for event with custom `playerConfig`, verify response includes `playerConfig`; open player, inspect hls.js instance config in browser devtools (`hls.config.liveSyncDurationCount`)
9. **Default inheritance**: Create event WITHOUT overrides, verify stream-config endpoint returns system defaults; change system defaults, verify inherited events pick up new values while overridden fields stay pinned
10. **E2E latency test**: Apply optimized defaults (hlsTime: 2, liveSyncDurationCount: 2, tune: zerolatency), publish via FFmpeg with keyint=30, measure end-to-end latency — target ~8-10s (down from ~20s)

---

## Scope

**Included**:
- Data model for per-event + system-wide transcoder and player config
- Admin UI for system defaults and per-event advanced settings
- Internal API for transcoder to fetch config
- Transcoder refactor to use dynamic config
- Player integration to use per-event config
- Multi-codec architecture design (path conventions, self-filtering, dynamic master playlist)

**Excluded**:
- Actually building AV1/VP9 transcoder images (future work, documented pattern)
- Per-event RTMP ingest tokens via auth hook (natural follow-up — the `/api/rtmp/auth` endpoint already exists; extending the Event model with per-event ingest credentials is independent of stream optimization controls)
- LL-HLS implementation (separate major effort, documented as future)
- Source encoder keyframe interval control (OBS-side, documented as operational guidance)
- Viewer-facing latency controls
- HLS server playlist caching (independent optimization, not per-event)
