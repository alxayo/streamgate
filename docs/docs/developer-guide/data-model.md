---
sidebar_position: 6
title: Data Model
---

# Data Model

StreamGate uses **Prisma ORM** with three core models: `Event`, `Token`, and `ActiveSession`. The schema is defined in `platform/prisma/schema.prisma`.

## Entity Relationship Diagram

```
┌─────────────────────────────────────┐
│               Event                 │
│─────────────────────────────────────│
│  id              String  (PK, UUID) │
│  title           String             │
│  description     String?            │
│  streamUrl       String?            │
│  posterUrl       String?            │
│  startsAt        DateTime           │
│  endsAt          DateTime           │
│  accessWindowHours  Int  (default 48)│
│  isActive        Boolean (default T) │
│  isArchived      Boolean (default F) │
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
```

**Relationships:**
- An **Event** has many **Tokens** (one-to-many, cascade delete)
- A **Token** has many **ActiveSessions** (one-to-many, cascade delete)
- In practice, single-device enforcement means at most one ActiveSession per Token at any given time

## Event Model

An event represents a streaming occasion — a live broadcast, recorded session, or on-demand content.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | `String` | UUID (auto) | Primary key |
| `title` | `String` | — | Display title shown to viewers |
| `description` | `String?` | `null` | Optional description |
| `streamUrl` | `String?` | `null` | Upstream origin URL (proxy/hybrid mode) |
| `posterUrl` | `String?` | `null` | Poster image URL for pre-event/ended screens |
| `startsAt` | `DateTime` | — | Scheduled start time |
| `endsAt` | `DateTime` | — | Scheduled end time |
| `accessWindowHours` | `Int` | `48` | Hours after `endsAt` that tokens remain valid |
| `isActive` | `Boolean` | `true` | Whether the event is accessible to viewers |
| `isArchived` | `Boolean` | `false` | Whether the event is archived (hidden from active listings) |
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
