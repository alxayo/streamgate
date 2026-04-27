---
sidebar_position: 6
title: Data Model
---

# Data Model

StreamGate uses **Prisma ORM** with nine models: `Event`, `Token`, `ActiveSession`, `SystemSettings`, `AdminUser`, `RecoveryCode`, `AuditLog`, `Creator`, and `Channel`. The schema is defined in `platform/prisma/schema.prisma`.

## Entity Relationship Diagram

```
┌─────────────────────────────────────┐
│               Event                 │
│─────────────────────────────────────│
│  id              String  (PK, UUID) │
│  title           String             │
│  description     String?            │
│  streamType      String  (LIVE/VOD) │
│  streamUrl       String?            │
│  posterUrl       String?            │
│  startsAt        DateTime           │
│  endsAt          DateTime           │
│  accessWindowHours  Int  (default 48)│
│  isActive        Boolean (default T) │
│  isArchived      Boolean (default F) │
│  autoPurge       Boolean (default T) │
│  transcoderConfig String? (JSON)    │
│  playerConfig     String? (JSON)    │
│  createdAt       DateTime (auto)    │
│  updatedAt       DateTime (auto)    │
└─────────────┬───────────────────────┘
              │ 1:N
              │
┌─────────────▼───────────────────────┐
│               Token                 │
│─────────────────────────────────────│
│  id              String  (PK, UUID) │
│  code            String  (UNIQUE)   │
│  eventId         String  (FK→Event) │
│  label           String?            │
│  isRevoked       Boolean (default F) │
│  revokedAt       DateTime?          │
│  redeemedAt      DateTime?          │
│  redeemedIp      String?            │
│  expiresAt       DateTime           │
│  createdAt       DateTime (auto)    │
└─────────────┬───────────────────────┘
              │ 1:N
              │
┌─────────────▼───────────────────────┐
│          ActiveSession              │
│─────────────────────────────────────│
│  id              String  (PK, UUID) │
│  tokenId         String  (FK→Token) │
│  sessionId       String  (UNIQUE)   │
│  lastHeartbeat   DateTime (auto)    │
│  clientIp        String             │
│  userAgent       String?            │
│  createdAt       DateTime (auto)    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│         SystemSettings              │
│─────────────────────────────────────│
│  id               String (PK)      │
│  transcoderDefaults String (JSON)   │
│  playerDefaults    String (JSON)    │
│  updatedAt         DateTime (auto)  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│            AdminUser                │
│─────────────────────────────────────│
│  id              String  (PK, UUID) │
│  visibleId       Int (UNIQUE, auto) │
│  username        String  (UNIQUE)   │
│  passwordHash    String             │
│  role            String             │
│  totpSecret      String?            │
│  twoFactorEnabled Boolean (def F)   │
│  twoFactorVerified Boolean (def F)  │
│  isActive        Boolean (def T)    │
│  lastLoginAt     DateTime?          │
│  createdAt       DateTime (auto)    │
│  updatedAt       DateTime (auto)    │
└─────────────┬──────────┬────────────┘
              │ 1:N      │ 1:N
              │          │
┌─────────────▼──────┐  ┌▼────────────────────────────┐
│   RecoveryCode     │  │         AuditLog            │
│────────────────────│  │─────────────────────────────│
│  id     String(PK) │  │  id        String (PK,UUID) │
│  userId String(FK) │  │  userId    String? (FK)     │
│  codeHash String   │  │  username  String           │
│  usedAt DateTime?  │  │  action    String           │
│  createdAt DateTime│  │  resource  String?          │
└────────────────────┘  │  ipAddress String?          │
                        │  userAgent  String?          │
                        │  createdAt  DateTime (auto)  │
                        └──────────────────────────────┘
```

**Relationships:**
- A **Creator** has many **Channels** (one-to-many, cascade delete)
- A **Channel** has many **Events** (one-to-many, set null on delete)
- An **Event** has many **Tokens** (one-to-many, cascade delete)
- A **Token** has many **ActiveSessions** (one-to-many, cascade delete)
- An **AdminUser** has many **RecoveryCodes** (one-to-many, cascade delete)
- An **AdminUser** has many **AuditLog** entries (one-to-many, set null on delete)
- In practice, single-device enforcement means at most one ActiveSession per Token at any given time

:::info Multi-Tenant Model
Events can optionally belong to a **Channel** (via `channelId`). Events with `channelId = null` are platform-level admin events (backward compatible). When a channel is suspended, RTMP publish auth is rejected for all events in that channel.
:::

## Creator Model

A content creator who owns one or more channels. Creators have a completely separate auth system from admins (different cookie, login page, middleware, and session management).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `email` | `String` | — | Login identifier (unique) |
| `passwordHash` | `String` | — | bcrypt-hashed password (12 salt rounds) |
| `displayName` | `String` | — | Public-facing display name |
| `isActive` | `Boolean` | `true` | Admin can suspend (blocks login + stream access) |
| `isEmailVerified` | `Boolean` | `false` | For future email verification gating |
| `isPendingApproval` | `Boolean` | `false` | True when registered under "approval" mode |
| `totpSecret` | `String?` | `null` | Encrypted TOTP secret (AES-256-GCM) |
| `totpEnabled` | `Boolean` | `false` | Whether 2FA is active |
| `failedLoginAttempts` | `Int` | `0` | Consecutive failed password attempts |
| `lockedUntil` | `DateTime?` | `null` | Account locked until this time |
| `lastLoginAt` | `DateTime?` | `null` | Last successful login |
| `createdAt` | `DateTime` | `now()` | Registration timestamp |
| `updatedAt` | `DateTime` | auto | Last modification timestamp |

### Account Lockout

After 5 consecutive failed login attempts, the account is locked for 15 minutes:

```
failedLoginAttempts >= 5 → lockedUntil = now + 15 minutes
```

A successful login resets `failedLoginAttempts` to 0 and clears `lockedUntil`. Admins can also unlock accounts from the Creators management page.

### Registration Modes

The `SystemSettings.creatorRegistrationMode` field controls self-service signup:

| Mode | Behavior |
|------|----------|
| `open` | Account is immediately active; creator auto-logged in |
| `approval` | Account created with `isPendingApproval=true`; cannot log in until admin approves |
| `disabled` | Registration endpoint returns 403; only admins can create creator accounts |

## Channel Model

A content channel owned by a creator. Channels are the namespace for events — each event optionally belongs to one channel.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `creatorId` | `String` | — | Owner (FK → Creator) |
| `name` | `String` | — | Display name |
| `slug` | `String` | — | URL-safe identifier (unique), e.g., "tech-talks" |
| `description` | `String?` | `null` | Channel description |
| `logoUrl` | `String?` | `null` | Channel branding image URL |
| `isActive` | `Boolean` | `true` | Admin can suspend (blocks RTMP publish for events in this channel) |
| `createdAt` | `DateTime` | `now()` | Creation timestamp |
| `updatedAt` | `DateTime` | auto | Last modification timestamp |

### Channel Suspension

When a channel's `isActive` is set to `false`:
1. The RTMP auth callback (`/api/rtmp/auth`) checks `event.channel.isActive` during publish validation
2. If the channel is suspended, publish requests return 403 → OBS/FFmpeg shows "connection rejected"
3. Existing tokens for the channel's events remain valid for viewing (HLS server doesn't check channel status)

## Event Model

An event represents a streaming occasion — a live broadcast, recorded session, or on-demand content.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `title` | `String` | — | Display title shown to viewers |
| `description` | `String?` | `null` | Optional description |
| `streamType` | `String` | `"LIVE"` | Event type: `"LIVE"` or `"VOD"` |
| `streamUrl` | `String?` | `null` | Upstream origin URL (proxy/hybrid mode) |
| `posterUrl` | `String?` | `null` | Poster image URL for pre-event/ended screens |
| `startsAt` | `DateTime` | — | Scheduled start time |
| `endsAt` | `DateTime` | — | Scheduled end time |
| `accessWindowHours` | `Int` | `48` | Hours after `endsAt` that tokens remain valid |
| `isActive` | `Boolean` | `true` | Whether the event is accessible to viewers |
| `isArchived` | `Boolean` | `false` | Whether the event is archived (hidden from active listings) |
| `autoPurge` | `Boolean` | `true` | Whether to auto-purge expired tokens |
| `transcoderConfig` | `String?` | `null` | JSON: per-event transcoder overrides (null = use system defaults) |
| `playerConfig` | `String?` | `null` | JSON: per-event player overrides (null = use system defaults) |
| `channelId` | `String?` | `null` | FK → Channel (null = platform-level admin event) |
| `createdAt` | `DateTime` | `now()` | Creation timestamp |
| `updatedAt` | `DateTime` | auto | Last modification timestamp |

### Event States

```
isActive=true, isArchived=false   → Active (viewers can access)
isActive=false, isArchived=false  → Deactivated (all tokens effectively revoked)
isActive=true, isArchived=true    → Archived (hidden but technically accessible)
isActive=false, isArchived=true   → Archived + Deactivated
```

:::info
Deactivating an event triggers a revocation cascade: the HLS server's revocation sync picks up all token codes for deactivated events via the `eventDeactivations` array in the sync response.
:::

## Token Model

A token is a unique access code that grants a viewer permission to watch a specific event.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `code` | `String` | — | 12-char base62 access code (unique) |
| `eventId` | `String` | — | Foreign key to Event |
| `label` | `String?` | `null` | Admin-assigned label (e.g., "VIP Guest 1") |
| `isRevoked` | `Boolean` | `false` | Whether the token has been revoked by admin |
| `revokedAt` | `DateTime?` | `null` | When the token was revoked |
| `redeemedAt` | `DateTime?` | `null` | When the token was first used |
| `redeemedIp` | `String?` | `null` | IP address of first redemption |
| `expiresAt` | `DateTime` | — | Computed: `event.endsAt + event.accessWindowHours` |
| `createdAt` | `DateTime` | `now()` | Creation timestamp |

### Token Code Generation

Codes are generated using cryptographically secure random bytes:

```typescript
import crypto from 'node:crypto';

const TOKEN_CODE_LENGTH = 12;
const TOKEN_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateTokenCode(): string {
  const bytes = crypto.randomBytes(TOKEN_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < TOKEN_CODE_LENGTH; i++) {
    code += TOKEN_CODE_CHARSET[bytes[i] % TOKEN_CODE_CHARSET.length];
  }
  return code;
}
```

- **Character set**: 62 characters (a-z, A-Z, 0-9) — base62
- **Length**: 12 characters
- **Entropy**: ~71 bits (log₂(62¹²) ≈ 71.45)
- **Uniqueness**: Guaranteed within batches using a `Set`; database `UNIQUE` constraint as final guard

### Token Expiry Computation

Token expiry is computed at creation time, not checked dynamically:

```
expiresAt = event.endsAt + event.accessWindowHours (in hours)
```

For example, an event ending at `2025-03-15T17:00:00Z` with a 48-hour access window produces tokens expiring at `2025-03-17T17:00:00Z`.

:::warning
If the event's `endsAt` or `accessWindowHours` is updated after tokens are created, existing tokens **do not** automatically update their `expiresAt`. Generate new tokens if schedule changes are significant.
:::

### Token Status

Tokens have a computed status based on their fields:

| Status | Condition |
|--------|-----------|
| `unused` | `redeemedAt` is null AND not expired AND not revoked |
| `redeemed` | `redeemedAt` is set AND not expired AND not revoked |
| `expired` | `expiresAt < now` |
| `revoked` | `isRevoked` is true |

## ActiveSession Model

An active session represents a currently viewing user. It enforces single-device access.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `tokenId` | `String` | — | Foreign key to Token |
| `sessionId` | `String` | UUID (auto) | Unique session identifier (matches JWT `sid` claim) |
| `lastHeartbeat` | `DateTime` | `now()` | Last heartbeat timestamp |
| `clientIp` | `String` | — | Viewer's IP address |
| `userAgent` | `String?` | `null` | Browser user agent string |
| `createdAt` | `DateTime` | `now()` | Session creation time |

### Session Lifecycle

```
1. CREATE   Viewer validates token → createSession()
             Creates ActiveSession with fresh sessionId
             Cleans up any stale sessions for this token

2. HEARTBEAT  Every 30 seconds → updateHeartbeat()
               Updates lastHeartbeat to now()

3. RELEASE   Player closes → releaseSession()
              Deletes the ActiveSession record

4. TIMEOUT   No heartbeat for 60 seconds
              Session considered abandoned
              Next validation request cleans it up
              Another device can now use the token
```

:::tip
The session timeout is configurable via `SESSION_TIMEOUT_SECONDS` (default: 60). A session is stale when `lastHeartbeat < now - SESSION_TIMEOUT_SECONDS`.
:::

## SystemSettings Model

A singleton model storing system-wide default configuration for stream transcoding and player behavior. Managed via the Admin Settings page (`/admin/settings`).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | `"default"` | Singleton primary key |
| `transcoderDefaults` | `String` | — | JSON: system-wide transcoder defaults (`TranscoderConfig`) |
| `playerDefaults` | `String` | — | JSON: system-wide player defaults (`PlayerConfig`) |
| `creatorRegistrationMode` | `String` | `"open"` | Creator signup mode: `"open"`, `"approval"`, or `"disabled"` |
| `updatedAt` | `DateTime` | auto | Last modification timestamp |

### Stream Configuration Inheritance

Stream configuration follows a two-level inheritance model:

1. **System defaults** — stored in `SystemSettings`, editable at `/admin/settings`
2. **Per-event overrides** — stored in `Event.transcoderConfig` / `Event.playerConfig` (null = inherit system defaults)

The effective config for any event is computed server-side via `mergeStreamConfig()`:

```typescript
const effective = {
  ...systemDefaults.transcoder,
  ...eventOverrides?.transcoder,
  h264: { ...systemDefaults.transcoder.h264, ...(eventOverrides?.transcoder?.h264 ?? {}) },
};
```

- New events start with `null` overrides and inherit system defaults
- If system defaults change, all inheriting events pick up the new values automatically
- Per-event overrides are stored only when the admin explicitly customizes an event
- The admin UI shows a "System Default" / "Custom" badge per event

### Default Configuration Values

```json
{
  "transcoder": {
    "codecs": ["h264"],
    "profile": "full-abr-1080p-720p-480p",
    "hlsTime": 2,
    "hlsListSize": 6,
    "forceKeyFrameInterval": 2,
    "h264": { "tune": "zerolatency", "preset": "ultrafast" }
  },
  "player": {
    "liveSyncDurationCount": 2,
    "liveMaxLatencyDurationCount": 4,
    "backBufferLength": 0,
    "lowLatencyMode": true
  }
}
```

:::info Bootstrap Guard
The API routes for `GET /api/admin/settings` and `GET /api/internal/events/:id/stream-config` use upsert-or-return-hardcoded-defaults logic, so a missing `SystemSettings` row never causes a 500 error.
:::

## Access Rules

### Platform-Level Validation (Token Validation Endpoint)

A token is valid for access when **all** of these conditions are met:

| # | Check | HTTP Status on Failure |
|---|-------|------------------------|
| 1 | Token code exists in database | 401 |
| 2 | `expiresAt > now` | 410 |
| 3 | `isRevoked === false` | 403 |
| 4 | Associated event has `isActive === true` | 403 |
| 5 | No active session exists (or existing session timed out) | 409 |

### HLS-Level Validation (Every Streaming Request)

The HLS server performs these checks on every `.m3u8` and `.ts` request:

| # | Check | HTTP Status on Failure |
|---|-------|------------------------|
| 1 | JWT signature is valid (HMAC-SHA256) | 403 |
| 2 | JWT has not expired (`exp > now`) | 403 |
| 3 | Request path starts with JWT's `sp` claim | 403 |
| 4 | If `probe === true`, request must be HEAD | 403 |
| 5 | Token code (`sub`) is not in the revocation cache | 403 |

## Prisma Schema

```prisma title="platform/prisma/schema.prisma"
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "sqlite"
}

model Event {
  id                String   @id @default(uuid())
  title             String
  description       String?
  streamUrl         String?
  posterUrl         String?
  startsAt          DateTime
  endsAt            DateTime
  accessWindowHours Int      @default(48)
  isActive          Boolean  @default(true)
  isArchived        Boolean  @default(false)
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  tokens Token[]
}

model Token {
  id         String    @id @default(uuid())
  code       String    @unique
  eventId    String
  label      String?
  isRevoked  Boolean   @default(false)
  revokedAt  DateTime?
  redeemedAt DateTime?
  redeemedIp String?
  expiresAt  DateTime
  createdAt  DateTime  @default(now())

  event          Event           @relation(fields: [eventId], references: [id], onDelete: Cascade)
  activeSessions ActiveSession[]

  @@index([eventId])
  @@index([code])
  @@index([isRevoked])
}

model ActiveSession {
  id            String   @id @default(uuid())
  tokenId       String
  sessionId     String   @unique
  lastHeartbeat DateTime @default(now())
  clientIp      String
  userAgent     String?
  createdAt     DateTime @default(now())

  token Token @relation(fields: [tokenId], references: [id], onDelete: Cascade)

  @@index([tokenId])
  @@index([sessionId])
  @@index([lastHeartbeat])
}
```

## Database Indexes

| Model | Index | Purpose |
|-------|-------|---------|
| `Token` | `code` (unique) | Fast O(1) lookup during token validation |
| `Token` | `eventId` | Fast listing of tokens per event |
| `Token` | `isRevoked` | Fast filtering for revocation sync queries |
| `ActiveSession` | `sessionId` (unique) | Fast session lookup during heartbeat/release |
| `ActiveSession` | `tokenId` | Fast check for existing sessions per token |
| `ActiveSession` | `lastHeartbeat` | Fast identification of stale sessions |
| `AdminUser` | `username` (unique) | Fast login lookup |
| `AdminUser` | `visibleId` (unique) | Human-readable user identifier |
| `RecoveryCode` | `userId` | Fast lookup of codes per user |
| `AuditLog` | `userId` | Filter entries by actor |
| `AuditLog` | `createdAt` | Chronological queries and pagination |

## AdminUser Model

An admin user account with credentials, TOTP secret, and role assignment.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `visibleId` | `Int` | Auto-increment | Human-readable ID shown in UI |
| `username` | `String` | — | Unique login username |
| `passwordHash` | `String` | — | Bcrypt hash (cost factor 12) |
| `role` | `String` | `"operator"` | One of: `super_admin`, `admin`, `operator` |
| `totpSecret` | `String?` | `null` | AES-256-GCM encrypted TOTP secret (null if 2FA not set up) |
| `twoFactorEnabled` | `Boolean` | `false` | Whether 2FA setup has been initiated |
| `twoFactorVerified` | `Boolean` | `false` | Whether 2FA setup has been confirmed with a valid code |
| `isActive` | `Boolean` | `true` | Whether the account can log in (soft-delete pattern) |
| `lastLoginAt` | `DateTime?` | `null` | Timestamp of most recent successful login |
| `createdAt` | `DateTime` | `now()` | Account creation timestamp |
| `updatedAt` | `DateTime` | auto | Last modification timestamp |

### Role Hierarchy

```
super_admin → All permissions (user management, audit log, settings, events, tokens, dashboard)
admin       → Events, tokens, settings, dashboard
operator    → Dashboard (read-only)
```

:::info First-boot seeding
On first server start, if no `AdminUser` records exist, a default `super_admin` user named `admin` is created using the `ADMIN_PASSWORD_HASH` environment variable. This user must complete 2FA setup on first login.
:::

## RecoveryCode Model

One-time backup codes for two-factor authentication recovery.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `userId` | `String` | — | FK → AdminUser |
| `codeHash` | `String` | — | Bcrypt hash of the recovery code |
| `usedAt` | `DateTime?` | `null` | When the code was consumed (null = unused) |
| `createdAt` | `DateTime` | `now()` | Generation timestamp |

- 8 codes are generated during 2FA setup confirmation
- Each code is 8-character alphanumeric (base62)
- Codes are hashed with bcrypt before storage — plaintext shown only once during setup
- Using a code marks it with `usedAt` timestamp — it cannot be reused
- All codes cascade-delete when the parent AdminUser is deleted

## AuditLog Model

Immutable append-only log of all admin actions for forensic auditing.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `userId` | `String?` | — | FK → AdminUser (nullable for system events) |
| `username` | `String` | — | Actor's username (denormalized for query performance) |
| `action` | `String` | — | Action type identifier |
| `resource` | `String?` | `null` | Target of the action (e.g., affected username, event ID) |
| `ipAddress` | `String?` | `null` | Client IP address |
| `userAgent` | `String?` | `null` | Browser user-agent string |
| `createdAt` | `DateTime` | `now()` | Timestamp (never modified) |

### Action Types

| Action | Description |
|--------|-------------|
| `login_success` | Successful password verification |
| `login_failed` | Failed login attempt |
| `two_factor_verified` | TOTP code verified successfully |
| `recovery_code_used` | Recovery code consumed |
| `emergency_login` | Emergency bypass login |
| `logout` | Session destroyed |
| `two_factor_setup_complete` | 2FA enrollment confirmed |
| `2fa_reset` | Another user's 2FA was reset |
| `user_created` | New admin user created |
| `user_updated` | Admin user fields modified |
| `user_deactivated` | Admin user account disabled |

:::note Immutability
Audit log entries can never be modified or deleted through the application. They provide a tamper-evident trail for security investigations.
:::

## Migration Workflow

### Development

```bash
cd platform

# Create a new migration after modifying schema.prisma
npx prisma migrate dev --name describe-your-change

# Reset database (drops all data)
npx prisma migrate reset

# Open Prisma Studio (visual database browser)
npx prisma studio
```

### Production

```bash
# Apply pending migrations (no interactive prompts)
npx prisma migrate deploy
```

:::danger
Never use `prisma migrate dev` in production. It can reset data. Always use `prisma migrate deploy` for production deployments.
:::
