# Implementation Plan — Ticket-Gated Video Streaming Platform

> **Reference**: [PDR.md](PDR.md) for full specification, data model, API contracts, and deployment topologies.

---

## Table of Contents

1. [Work Streams Overview](#1-work-streams-overview)
2. [Dependency Graph](#2-dependency-graph)
3. [Phase 0 — Shared Foundation](#3-phase-0--shared-foundation)
4. [Phase 1 — Core Infrastructure (Parallel Streams)](#4-phase-1--core-infrastructure)
5. [Phase 2 — Feature Implementation (Parallel Streams)](#5-phase-2--feature-implementation)
6. [Phase 3 — Integration & Cross-Service Features](#6-phase-3--integration--cross-service-features)
7. [Phase 4 — Polish, Security & Production Readiness](#7-phase-4--polish-security--production-readiness)

---

## 1. Work Streams Overview

Three independent developer work streams, each focused on a service:

| Stream | Service | Directory | Owner | Can Start After |
|--------|---------|-----------|-------|-----------------|
| **WS-S** | Shared Infrastructure | `shared/` | Dev A | — (first) |
| **WS-P** | Platform App (Next.js) | `platform/` | Dev B | WS-S Phase 0 complete |
| **WS-H** | HLS Media Server (Express) | `hls-server/` | Dev C | WS-S Phase 0 complete |

**Naming Convention**: Tasks are prefixed with their stream — `S-##` (Shared), `P-##` (Platform), `H-##` (HLS).

**Commit Guidance**: Each task below is scoped to a single logical commit. The commit message should match the task ID and title (e.g., `S-01: Initialize monorepo and root configuration`).

---

## 2. Dependency Graph

```
Phase 0 (Sequential)
  S-01 → S-02 → S-03
                   │
          ┌────────┼────────┐
          ▼        ▼        ▼
Phase 1 (Parallel Streams)
  P-01─P-08    H-01─H-06    (independent)
          │        │
          ▼        ▼
Phase 2 (Parallel Streams)
  P-09─P-22    H-07─H-14    (independent)
          │        │
          └────┬───┘
               ▼
Phase 3 (Integration)
  I-01─I-06 (requires both P and H streams)
               │
               ▼
Phase 4 (Polish)
  F-01─F-08 (final polish)
```

### Key Cross-Stream Dependencies

| Blocked Task | Depends On | Reason |
|-------------|-----------|--------|
| P-01 | S-03 | Platform needs shared types/constants |
| H-01 | S-03 | HLS server needs shared types/constants |
| I-01 | P-08, H-06 | Integration tests need both APIs running |
| I-02 | P-14, H-08 | Revocation sync needs both endpoints ready |
| I-03 | P-17, H-06 | End-to-end playback needs viewer portal + HLS serving |

---

## 3. Phase 0 — Shared Foundation

> **Goal**: Establish the monorepo structure, shared types, and configuration so both service streams can begin independently.
> **All three tasks are sequential. Both WS-P and WS-H are blocked until Phase 0 completes.**

---

### S-01: Initialize monorepo and root configuration

**Objective**: Create the top-level directory structure and shared developer tooling.

**Files to create**:
```
/
├── .gitignore
├── .nvmrc                    # Node.js version (20 LTS)
├── package.json              # Root workspace config (npm workspaces)
├── tsconfig.base.json        # Shared TypeScript strict config
├── .eslintrc.json            # Root ESLint config (extends shared)
├── .prettierrc               # Prettier config
├── .env.example              # Documented env vars for all services
├── platform/                 # (empty, created by P-01)
├── hls-server/               # (empty, created by H-01)
└── shared/                   # Shared types/constants
```

**Implementation Details**:

1. **`package.json`** (root):
   ```json
   {
     "name": "video-streaming-platform",
     "private": true,
     "workspaces": ["shared", "platform", "hls-server"],
     "engines": { "node": ">=20.0.0" },
     "scripts": {
       "lint": "eslint . --ext .ts,.tsx",
       "format": "prettier --write .",
       "format:check": "prettier --check ."
     }
   }
   ```

2. **`tsconfig.base.json`**:
   - `strict: true`, `esModuleInterop: true`, `skipLibCheck: true`
   - `target: "ES2022"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`
   - `resolveJsonModule: true`, `isolatedModules: true`

3. **`.nvmrc`**: `20`

4. **`.gitignore`**: Standard Node.js ignores + `node_modules/`, `.env`, `.env.local`, `*.db`, `*.sqlite`, `dist/`, `.next/`, `coverage/`, `.turbo/`

5. **`.env.example`**: Document all environment variables from both services (see PDR §18.1, §18.2):
   ```env
   # === Shared ===
   PLAYBACK_SIGNING_SECRET=         # HMAC-SHA256 secret (min 32 chars, must match both services)
   INTERNAL_API_KEY=                # Shared API key for internal endpoints

   # === Platform App ===
   DATABASE_URL=file:./dev.db       # SQLite for dev, PostgreSQL connection string for prod
   ADMIN_PASSWORD_HASH=             # bcrypt hash of admin password
   HLS_SERVER_BASE_URL=http://localhost:4000  # Public URL of HLS Media Server
   NEXT_PUBLIC_APP_NAME=StreamGate  # Branding name
   SESSION_TIMEOUT_SECONDS=60       # Seconds before inactive viewing session is considered abandoned

   # === HLS Media Server ===
   PLATFORM_APP_URL=http://localhost:3000  # Platform App URL for revocation polling
   STREAM_ROOT=./streams            # Local filesystem path for stream files
   UPSTREAM_ORIGIN=                 # Upstream HLS origin (blank = local only)
   SEGMENT_CACHE_ROOT=              # Defaults to STREAM_ROOT/cache/
   SEGMENT_CACHE_MAX_SIZE_GB=50
   SEGMENT_CACHE_MAX_AGE_HOURS=72
   REVOCATION_POLL_INTERVAL_MS=30000
   CORS_ALLOWED_ORIGIN=http://localhost:3000
   PORT=4000
   ```

6. **`.eslintrc.json`**: Configure TypeScript ESLint with `@typescript-eslint/recommended`, Prettier integration.

7. **`.prettierrc`**:
   ```json
   {
     "semi": true,
     "singleQuote": true,
     "trailingComma": "all",
     "printWidth": 100,
     "tabWidth": 2
   }
   ```

**Commit**: `S-01: Initialize monorepo with npm workspaces, TypeScript, ESLint, Prettier`

---

### S-02: Create shared package with types and constants

**Objective**: Define TypeScript types and constants shared between Platform App and HLS Server.

**Files to create**:
```
shared/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # Re-exports everything
    ├── types.ts              # Shared type definitions
    ├── constants.ts          # Shared constants
    └── jwt.ts                # JWT claim types and helpers
```

**Implementation Details**:

1. **`shared/package.json`**:
   ```json
   {
     "name": "@streaming/shared",
     "version": "1.0.0",
     "private": true,
     "main": "./src/index.ts",
     "types": "./src/index.ts",
     "scripts": {
       "typecheck": "tsc --noEmit"
     }
   }
   ```

2. **`shared/src/types.ts`** — Shared domain types:
   ```typescript
   /** JWT playback token claims (PDR §4.3) */
   export interface PlaybackTokenClaims {
     sub: string;    // Access token code
     eid: string;    // Event ID
     sid: string;    // Active session ID (for single-device enforcement)
     sp: string;     // Allowed stream path prefix (e.g., "/streams/evt-uuid/")
     iat: number;    // Issued at (Unix timestamp)
     exp: number;    // Expires at (Unix timestamp)
     probe?: boolean; // If true, this is a probe JWT (HEAD requests only)
   }

   /** Revocation sync response (PDR §10.3) */
   export interface RevocationSyncResponse {
     revocations: Array<{
       code: string;
       revokedAt: string; // ISO 8601
     }>;
     eventDeactivations: Array<{
       eventId: string;
       deactivatedAt: string; // ISO 8601
       tokenCodes: string[];
     }>;
     serverTime: string; // ISO 8601
   }

   /** Event status values (PDR §10.1) */
   export type EventStatus = 'not-started' | 'live' | 'ended' | 'recording';

   /** Token status values (PDR §8.4) */
   export type TokenStatus = 'unused' | 'redeemed' | 'expired' | 'revoked';

   /** Public event metadata returned to viewer (PDR §10.1) */
   export interface PublicEventInfo {
     title: string;
     description: string | null;
     startsAt: string;
     endsAt: string;
     posterUrl: string | null;
     isLive: boolean;
   }

   /** Token validation success response (PDR §10.1) */
   export interface TokenValidationResponse {
     event: PublicEventInfo;
     playbackToken: string;
     playbackBaseUrl: string;
     streamPath: string;
     expiresAt: string;
     tokenExpiresIn: number;
   }

   /** JWT refresh response (PDR §10.1) */
   export interface TokenRefreshResponse {
     playbackToken: string;
     tokenExpiresIn: number;
   }

   /** Event status response (PDR §10.1) */
   export interface EventStatusResponse {
     eventId: string;
     status: EventStatus;
     startsAt: string;
     endsAt: string;
   }

   /** Heartbeat response (PDR §10.1) */
   export interface HeartbeatResponse {
     ok: boolean;
   }

   /** Release response (PDR §10.1) */
   export interface ReleaseResponse {
     released: boolean;
   }

   /** Token in-use error response (PDR §10.1, 409) */
   export interface TokenInUseResponse {
     error: string;
     inUse: boolean;
   }

   /** Standard API error response */
   export interface ApiErrorResponse {
     error: string;
   }
   ```

3. **`shared/src/constants.ts`**:
   ```typescript
   /** JWT expiry duration in seconds (PDR §4.3: 1-hour expiry) */
   export const JWT_EXPIRY_SECONDS = 3600;

   /** JWT refresh interval in ms (PDR §4.3: refresh every 50 minutes) */
   export const JWT_REFRESH_INTERVAL_MS = 50 * 60 * 1000;

   /** Probe JWT expiry (PDR §10.1: 10-second expiry for stream probing) */
   export const PROBE_JWT_EXPIRY_SECONDS = 10;

   /** Token code length (PDR §5.2: 12-character base62) */
   export const TOKEN_CODE_LENGTH = 12;

   /** Token code character set (base62: a-z, A-Z, 0-9) */
   export const TOKEN_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

   /** Rate limit: token validation (PDR §12: 5/min per IP) */
   export const RATE_LIMIT_TOKEN_VALIDATION = { maxRequests: 5, windowMs: 60_000 };

   /** Rate limit: JWT refresh (PDR §12: 12/hour per token code) */
   export const RATE_LIMIT_JWT_REFRESH = { maxRequests: 12, windowMs: 3_600_000 };

   /** Rate limit: admin login (PDR §12: 10/min per IP) */
   export const RATE_LIMIT_ADMIN_LOGIN = { maxRequests: 10, windowMs: 60_000 };

   /** Revocation poll interval default (PDR §4.4: 30 seconds) */
   export const DEFAULT_REVOCATION_POLL_INTERVAL_MS = 30_000;

   /** Stream path prefix template (PDR §4.3: /streams/:eventId/) */
   export const STREAM_PATH_PREFIX = '/streams/';

   /** Max batch token generation (PDR §8.4: 1-500) */
   export const MAX_BATCH_TOKEN_COUNT = 500;

   /** Access window bounds in hours (PDR §8.3: 1-168 hours) */
   export const ACCESS_WINDOW_MIN_HOURS = 1;
   export const ACCESS_WINDOW_MAX_HOURS = 168;

   /** Default access window in hours (PDR §5.1: 48 hours) */
   export const DEFAULT_ACCESS_WINDOW_HOURS = 48;

   /** Admin session cookie expiry (PDR §8.1: 8 hours) */
   export const ADMIN_SESSION_EXPIRY_SECONDS = 8 * 3600;

   /** CORS preflight cache (PDR §6.4: 24 hours) */
   export const CORS_MAX_AGE_SECONDS = 86400;

   /** Expiry warning threshold — show toast (PDR §7.2: 15 minutes before) */
   export const EXPIRY_WARNING_MINUTES = 15;

   /** Expiry grace period (PDR §11: 60-second grace period) */
   export const EXPIRY_GRACE_PERIOD_SECONDS = 60;

   /** Pre-event status poll interval (PDR §7.3: every 30 seconds) */
   export const EVENT_STATUS_POLL_INTERVAL_MS = 30_000;

   /** Session heartbeat interval in ms (PDR §5.3: every 30 seconds) */
   export const HEARTBEAT_INTERVAL_MS = 30_000;

   /** Default session timeout in seconds (PDR §5.3: 60 seconds) */
   export const DEFAULT_SESSION_TIMEOUT_SECONDS = 60;

   /** Token code regex (alphanumeric only, PDR §12) */
   export const TOKEN_CODE_REGEX = /^[A-Za-z0-9]+$/;

   /** JWT algorithm */
   export const JWT_ALGORITHM = 'HS256';
   ```

4. **`shared/src/jwt.ts`** — JWT utility types (signing/verifying done in each service with `jose`):
   ```typescript
   import type { PlaybackTokenClaims } from './types';

   /**
    * Build the stream path prefix for a given event ID.
    * Convention: /streams/:eventId/ (PDR §4.3, §6.3)
    */
   export function buildStreamPathPrefix(eventId: string): string {
     return `/streams/${eventId}/`;
   }

   /**
    * Validate that a request path starts with the allowed stream path prefix.
    * Used by HLS server for path-scoping JWT validation (PDR §5.4 rule 4).
    */
   export function isPathAllowed(requestPath: string, allowedPrefix: string): boolean {
     return requestPath.startsWith(allowedPrefix);
   }

   /**
    * Validate token code format: must be alphanumeric (PDR §12).
    */
   export function isValidTokenCode(code: string): boolean {
     return typeof code === 'string' && code.length > 0 && /^[A-Za-z0-9]+$/.test(code);
   }
   ```

5. **`shared/src/index.ts`**: Re-export all:
   ```typescript
   export * from './types';
   export * from './constants';
   export * from './jwt';
   ```

**Commit**: `S-02: Create shared package with domain types, constants, and JWT helpers`

---

### S-03: Add shared development scripts and documentation

**Objective**: Add development convenience scripts, README, and verify the workspace setup.

**Files to create/modify**:
```
shared/
├── src/
│   └── validation.ts         # Input validation helpers
README.md                     # Developer quick-start guide
```

**Implementation Details**:

1. **`shared/src/validation.ts`** — reusable validation:
   ```typescript
   import { TOKEN_CODE_LENGTH, ACCESS_WINDOW_MIN_HOURS, ACCESS_WINDOW_MAX_HOURS } from './constants';

   /**
    * Sanitize and validate a token code input.
    * Trims whitespace, rejects non-alphanumeric characters.
    * Returns sanitized code or null if invalid.
    */
   export function sanitizeTokenCode(input: unknown): string | null {
     if (typeof input !== 'string') return null;
     const trimmed = input.trim();
     if (trimmed.length === 0) return null;
     if (!/^[A-Za-z0-9]+$/.test(trimmed)) return null;
     return trimmed;
   }

   /**
    * Validate access window hours (PDR §8.3: 1-168).
    */
   export function isValidAccessWindow(hours: number): boolean {
     return Number.isInteger(hours)
       && hours >= ACCESS_WINDOW_MIN_HOURS
       && hours <= ACCESS_WINDOW_MAX_HOURS;
   }

   /**
    * Validate that startsAt is before endsAt (PDR §8.3).
    */
   export function isValidEventSchedule(startsAt: Date, endsAt: Date): boolean {
     return startsAt < endsAt;
   }
   ```

2. Update **`shared/src/index.ts`** to also export validation:
   ```typescript
   export * from './validation';
   ```

3. **`README.md`** (root): Developer quick-start guide with:
   - Project overview (link to PDR.md)
   - Prerequisites (Node.js 20+, npm 10+)
   - Setup instructions for each service
   - Environment variable setup
   - Development workflow

**Commit**: `S-03: Add shared validation helpers and developer README`

---

## 4. Phase 1 — Core Infrastructure

> **Three streams run in parallel after Phase 0.**
> Devs can work independently on P-01–P-08, H-01–H-06, and come together at Phase 3.

---

### Stream: Platform App (WS-P) — Phase 1

---

#### P-01: Initialize Next.js project with TypeScript and Tailwind

**Depends on**: S-03

**Objective**: Scaffold the Next.js 14+ project with App Router, TypeScript strict mode, Tailwind CSS, and project-specific configuration.

**Commands**:
```bash
cd platform
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias
```

**Files to create/modify**:
```
platform/
├── package.json              # Add workspace dependency on @streaming/shared
├── tsconfig.json             # Extend from ../tsconfig.base.json
├── tailwind.config.ts        # Custom theme (PDR §14 colors, fonts)
├── next.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx        # Root layout with fonts (Inter, JetBrains Mono)
│   │   ├── page.tsx          # Placeholder home page
│   │   └── globals.css       # Tailwind directives + custom CSS vars
│   └── lib/
│       └── env.ts            # Environment variable validation
```

**Implementation Details**:

1. **`package.json`** additions:
   ```json
   {
     "dependencies": {
       "@streaming/shared": "workspace:*",
       "next": "^14.0.0",
       "react": "^18.0.0",
       "react-dom": "^18.0.0"
     },
     "devDependencies": {
       "@types/node": "^20",
       "@types/react": "^18",
       "@types/react-dom": "^18",
       "typescript": "^5"
     }
   }
   ```

2. **`tailwind.config.ts`** — custom theme from PDR §14:
   ```typescript
   import type { Config } from 'tailwindcss';

   const config: Config = {
     content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
     theme: {
       extend: {
         colors: {
           // Viewer Portal (Dark Theme) — PDR §14.1
           'cinema-black': '#1E1E1E',
           'charcoal': '#2E2E2E',
           'slate-hover': '#3D3D3D',
           'accent-blue': '#3B82F6',
           'live-red': '#EF4444',
           // Admin Console (Light Theme) — PDR §14.1
           'admin-bg': '#F9FAFB',
           'admin-text': '#111827',
           'admin-body': '#374151',
           'status-active': '#22C55E',
           'status-unused': '#F59E0B',
           'status-revoked': '#EF4444',
         },
         fontFamily: {
           sans: ['Inter', 'system-ui', 'sans-serif'],
           mono: ['JetBrains Mono', 'monospace'],
         },
         animation: {
           'pulse-live': 'pulse 2s ease-in-out infinite',
         },
       },
     },
     plugins: [],
   };
   export default config;
   ```

3. **`src/app/globals.css`**:
   ```css
   @tailwind base;
   @tailwind components;
   @tailwind utilities;

   @layer base {
     :root {
       --cinema-black: 0 0% 12%;
       --charcoal: 0 0% 18%;
       --accent-blue: 217 91% 60%;
     }
   }
   ```

4. **`src/app/layout.tsx`**: Import Inter and JetBrains Mono from `next/font/google`. Set metadata title from `NEXT_PUBLIC_APP_NAME`.

5. **`src/lib/env.ts`**: Validate required server env vars at startup:
   ```typescript
   function requireEnv(name: string): string {
     const value = process.env[name];
     if (!value) throw new Error(`Missing required environment variable: ${name}`);
     return value;
   }

   export const env = {
     ADMIN_PASSWORD_HASH: requireEnv('ADMIN_PASSWORD_HASH'),
     PLAYBACK_SIGNING_SECRET: requireEnv('PLAYBACK_SIGNING_SECRET'),
     INTERNAL_API_KEY: requireEnv('INTERNAL_API_KEY'),
     DATABASE_URL: requireEnv('DATABASE_URL'),
     HLS_SERVER_BASE_URL: requireEnv('HLS_SERVER_BASE_URL'),
     APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'StreamGate',
     SESSION_TIMEOUT_SECONDS: parseInt(process.env.SESSION_TIMEOUT_SECONDS || '60', 10),
   } as const;
   ```

**Commit**: `P-01: Initialize Next.js project with TypeScript, Tailwind, and custom theme`

---

#### P-02: Set up Prisma ORM with database schema

**Depends on**: P-01

**Objective**: Define the Prisma schema for Event, Token, and ActiveSession models per PDR §5.

**Files to create**:
```
platform/
├── prisma/
│   └── schema.prisma
└── src/
    └── lib/
        └── prisma.ts         # Prisma client singleton
```

**Implementation Details**:

1. Install: `npm install prisma @prisma/client` and `npx prisma init --datasource-provider sqlite`

2. **`prisma/schema.prisma`**:
   ```prisma
   generator client {
     provider = "prisma-client-js"
   }

   datasource db {
     provider = "sqlite"
     url      = env("DATABASE_URL")
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

3. **`src/lib/prisma.ts`** — Singleton for dev hot-reload:
   ```typescript
   import { PrismaClient } from '@prisma/client';

   const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

   export const prisma = globalForPrisma.prisma ?? new PrismaClient();

   if (process.env.NODE_ENV !== 'production') {
     globalForPrisma.prisma = prisma;
   }
   ```

4. Run initial migration: `npx prisma migrate dev --name init`

**Commit**: `P-02: Set up Prisma schema with Event, Token, and ActiveSession models, initial migration`

---

#### P-03: Implement JWT signing and token code generation utilities

**Depends on**: P-02

**Objective**: Create server-side utilities for JWT minting/verification and cryptographic token code generation.

**Files to create**:
```
platform/src/lib/
├── jwt.ts                    # JWT sign/verify with jose
├── token-generator.ts        # Crypto-safe base62 token code generator
├── session.service.ts        # Active session management (single-device enforcement)
└── rate-limiter.ts           # In-memory rate limiter
```

**Implementation Details**:

1. Install: `npm install jose`

2. **`src/lib/jwt.ts`**:
   ```typescript
   import { SignJWT, jwtVerify } from 'jose';
   import { PlaybackTokenClaims, JWT_EXPIRY_SECONDS, PROBE_JWT_EXPIRY_SECONDS,
            JWT_ALGORITHM, buildStreamPathPrefix } from '@streaming/shared';
   import { env } from './env';

   const secret = new TextEncoder().encode(env.PLAYBACK_SIGNING_SECRET);

   /**
    * Mint a playback JWT for a validated token (PDR §4.3).
    * Includes session ID for single-device enforcement.
    */
   export async function mintPlaybackToken(
     code: string,
     eventId: string,
     sessionId: string,
   ): Promise<{ token: string; expiresIn: number }> {
     const sp = buildStreamPathPrefix(eventId);
     const token = await new SignJWT({ sub: code, eid: eventId, sid: sessionId, sp } as unknown as Record<string, unknown>)
       .setProtectedHeader({ alg: JWT_ALGORITHM })
       .setIssuedAt()
       .setExpirationTime(`${JWT_EXPIRY_SECONDS}s`)
       .sign(secret);

     return { token, expiresIn: JWT_EXPIRY_SECONDS };
   }

   /**
    * Mint a short-lived probe JWT for stream status checking (PDR §10.1).
    */
   export async function mintProbeToken(eventId: string): Promise<string> {
     const sp = buildStreamPathPrefix(eventId);
     return new SignJWT({ eid: eventId, sp, probe: true } as unknown as Record<string, unknown>)
       .setProtectedHeader({ alg: JWT_ALGORITHM })
       .setIssuedAt()
       .setExpirationTime(`${PROBE_JWT_EXPIRY_SECONDS}s`)
       .sign(secret);
   }

   /**
    * Verify and decode a playback JWT.
    */
   export async function verifyPlaybackToken(token: string): Promise<PlaybackTokenClaims> {
     const { payload } = await jwtVerify(token, secret, { algorithms: [JWT_ALGORITHM] });
     return payload as unknown as PlaybackTokenClaims;
   }
   ```

3. **`src/lib/token-generator.ts`**:
   ```typescript
   import crypto from 'node:crypto';
   import { TOKEN_CODE_LENGTH, TOKEN_CODE_CHARSET } from '@streaming/shared';

   /**
    * Generate a cryptographically random base62 token code (PDR §5.2).
    * 12 characters = ~71 bits of entropy.
    */
   export function generateTokenCode(): string {
     const bytes = crypto.randomBytes(TOKEN_CODE_LENGTH);
     let code = '';
     for (let i = 0; i < TOKEN_CODE_LENGTH; i++) {
       code += TOKEN_CODE_CHARSET[bytes[i] % TOKEN_CODE_CHARSET.length];
     }
     return code;
   }

   /**
    * Generate multiple unique token codes.
    * Uses a Set to guarantee uniqueness within the batch.
    */
   export function generateTokenCodes(count: number): string[] {
     const codes = new Set<string>();
     while (codes.size < count) {
       codes.add(generateTokenCode());
     }
     return Array.from(codes);
   }
   ```

4. **`src/lib/rate-limiter.ts`**:
   ```typescript
   /**
    * Simple sliding window rate limiter (in-memory, PDR §12).
    * Keyed by identifier (IP address or token code).
    */
   interface RateLimitEntry {
     timestamps: number[];
   }

   export class RateLimiter {
     private store = new Map<string, RateLimitEntry>();
     private readonly maxRequests: number;
     private readonly windowMs: number;

     constructor(config: { maxRequests: number; windowMs: number }) {
       this.maxRequests = config.maxRequests;
       this.windowMs = config.windowMs;
     }

     /**
      * Check if the key is rate-limited. Returns true if the request is allowed.
      * If allowed, records the request.
      */
     check(key: string): { allowed: boolean; retryAfterMs?: number } {
       const now = Date.now();
       const entry = this.store.get(key) ?? { timestamps: [] };

       // Remove timestamps outside the window
       entry.timestamps = entry.timestamps.filter(t => t > now - this.windowMs);

       if (entry.timestamps.length >= this.maxRequests) {
         const oldestInWindow = entry.timestamps[0];
         const retryAfterMs = oldestInWindow + this.windowMs - now;
         return { allowed: false, retryAfterMs };
       }

       entry.timestamps.push(now);
       this.store.set(key, entry);
       return { allowed: true };
     }

     /**
      * Periodically clean up expired entries.
      * Call this on a timer (e.g., every 60 seconds).
      */
     cleanup(): void {
       const now = Date.now();
       for (const [key, entry] of this.store) {
         entry.timestamps = entry.timestamps.filter(t => t > now - this.windowMs);
         if (entry.timestamps.length === 0) {
           this.store.delete(key);
         }
       }
     }
   }
   ```

5. **`src/lib/session.service.ts`** — Active session management (PDR §5.3):
   ```typescript
   import crypto from 'node:crypto';
   import { prisma } from './prisma';
   import { env } from './env';

   /**
    * Check if a token has an active viewing session (PDR §5.3).
    * A session is active if its lastHeartbeat is within SESSION_TIMEOUT_SECONDS.
    */
   export async function getActiveSession(tokenId: string) {
     const cutoff = new Date(Date.now() - env.SESSION_TIMEOUT_SECONDS * 1000);
     return prisma.activeSession.findFirst({
       where: {
         tokenId,
         lastHeartbeat: { gte: cutoff },
       },
     });
   }

   /**
    * Create a new active session for a token.
    * Cleans up any stale sessions for the same token first.
    */
   export async function createSession(
     tokenId: string,
     clientIp: string,
     userAgent?: string,
   ): Promise<string> {
     const sessionId = crypto.randomUUID();
     const cutoff = new Date(Date.now() - env.SESSION_TIMEOUT_SECONDS * 1000);

     await prisma.$transaction([
       // Clean up stale sessions for this token
       prisma.activeSession.deleteMany({
         where: { tokenId, lastHeartbeat: { lt: cutoff } },
       }),
       // Create new session
       prisma.activeSession.create({
         data: { tokenId, sessionId, clientIp, userAgent },
       }),
     ]);

     return sessionId;
   }

   /**
    * Update session heartbeat timestamp.
    */
   export async function updateHeartbeat(sessionId: string) {
     return prisma.activeSession.update({
       where: { sessionId },
       data: { lastHeartbeat: new Date() },
     });
   }

   /**
    * Release (delete) an active session.
    */
   export async function releaseSession(sessionId: string) {
     return prisma.activeSession.delete({
       where: { sessionId },
     });
   }
   ```

**Commit**: `P-03: Add JWT signing, token code generation, session service, and rate limiter utilities`

---

#### P-04: Implement admin authentication (login/logout/session)

**Depends on**: P-01

**Objective**: Implement password-based admin authentication with encrypted cookie sessions (PDR §8.1).

**Files to create**:
```
platform/src/
├── lib/
│   └── session.ts            # iron-session config and helpers
├── app/api/admin/
│   ├── login/route.ts        # POST /api/admin/login
│   └── logout/route.ts       # POST /api/admin/logout
└── middleware.ts              # Protect /api/admin/* routes
```

**Implementation Details**:

1. Install: `npm install iron-session bcrypt` and `npm install -D @types/bcrypt`

2. **`src/lib/session.ts`**:
   ```typescript
   import { getIronSession, IronSession } from 'iron-session';
   import { cookies } from 'next/headers';
   import { ADMIN_SESSION_EXPIRY_SECONDS } from '@streaming/shared';

   export interface SessionData {
     isAdmin: boolean;
   }

   const sessionOptions = {
     password: process.env.PLAYBACK_SIGNING_SECRET!, // reuse for session encryption
     cookieName: 'admin_session',
     cookieOptions: {
       httpOnly: true,
       secure: process.env.NODE_ENV === 'production',
       sameSite: 'strict' as const,
       maxAge: ADMIN_SESSION_EXPIRY_SECONDS,
     },
   };

   export async function getSession(): Promise<IronSession<SessionData>> {
     const cookieStore = await cookies();
     return getIronSession<SessionData>(cookieStore, sessionOptions);
   }

   export async function requireAdmin(): Promise<void> {
     const session = await getSession();
     if (!session.isAdmin) {
       throw new Error('Unauthorized');
     }
   }
   ```

3. **`POST /api/admin/login`**:
   - Accept `{ password: string }` in request body
   - Compare with bcrypt against `ADMIN_PASSWORD_HASH`
   - Rate limit: 10/min per IP (PDR §12)
   - On success: set `session.isAdmin = true`, save session, return `{ data: { success: true } }`
   - On failure: return `401 { error: "Invalid credentials" }`

4. **`POST /api/admin/logout`**:
   - Destroy session, return `{ data: { success: true } }`

5. **`middleware.ts`** — Protect admin API routes:
   - Match `/api/admin/*` (except `/api/admin/login`)
   - Check session cookie; return 401 if no valid admin session

**Commit**: `P-04: Implement admin authentication with bcrypt and iron-session`

---

#### P-05: Implement admin event CRUD API routes

**Depends on**: P-02, P-04

**Objective**: Create all event management API endpoints (PDR §10.2).

**Files to create**:
```
platform/src/app/api/admin/events/
├── route.ts                               # GET (list), POST (create)
├── [id]/
│   ├── route.ts                           # GET (detail), PUT (update), DELETE
│   ├── deactivate/route.ts                # PATCH
│   ├── reactivate/route.ts                # PATCH
│   ├── archive/route.ts                   # PATCH
│   └── unarchive/route.ts                 # PATCH
```

**Implementation Details**:

1. **`GET /api/admin/events`**:
   - Query params: `status` (active/inactive/archived), `timeframe` (upcoming/past), `sort` (startDate/title/tokenCount), `page`, `limit`
   - Include token count per event (use `_count` in Prisma)
   - Default: active, non-archived, sorted by start date descending

2. **`POST /api/admin/events`**:
   - Body: `{ title, description?, streamUrl?, posterUrl?, startsAt, endsAt, accessWindowHours? }`
   - Validation (PDR §8.3):
     - `title` required, non-empty
     - `startsAt` must be before `endsAt`
     - `accessWindowHours` must be 1–168 (default 48)
     - `streamUrl` if provided must be a valid URL (format only, no probing)
   - Returns created event with 201

3. **`GET /api/admin/events/:id`**:
   - Include `_count` of tokens and breakdown by status

4. **`PUT /api/admin/events/:id`**:
   - Same validation as create
   - Updates `updatedAt` automatically via Prisma

5. **`PATCH /api/admin/events/:id/deactivate`**:
   - Set `isActive = false`
   - Return updated event

6. **`PATCH /api/admin/events/:id/reactivate`**:
   - Set `isActive = true`
   - Return updated event

7. **`PATCH /api/admin/events/:id/archive`**:
   - Set `isArchived = true`
   - Return updated event

8. **`PATCH /api/admin/events/:id/unarchive`**:
   - Set `isArchived = false`
   - Return updated event

9. **`DELETE /api/admin/events/:id`**:
   - Requires confirmation header: `X-Confirm-Delete: <event-title>` (must match)
   - Cascading delete: event + all associated tokens
   - Return 204 on success

**Commit**: `P-05: Implement admin event CRUD API routes with validation`

---

#### P-06: Implement admin token management API routes

**Depends on**: P-03, P-05

**Objective**: Create token generation, listing, revocation, and export endpoints (PDR §10.2).

**Files to create**:
```
platform/src/app/api/admin/
├── tokens/
│   ├── route.ts                               # GET (list all tokens)
│   ├── [id]/
│   │   ├── revoke/route.ts                    # PATCH
│   │   └── unrevoke/route.ts                  # PATCH
│   └── bulk-revoke/route.ts                   # POST
├── events/[id]/tokens/
│   ├── route.ts                               # GET (tokens for event)
│   ├── generate/route.ts                      # POST
│   └── export/route.ts                        # GET (CSV export)
└── dashboard/route.ts                         # GET (summary stats)
```

**Implementation Details**:

1. **`POST /api/admin/events/:id/tokens/generate`**:
   - Body: `{ count: number, label?: string }` (count: 1–500)
   - Generate unique codes using `generateTokenCodes(count)` from P-03
   - Compute `expiresAt = event.endsAt + event.accessWindowHours`
   - Use Prisma transaction for batch insert with `createMany`
   - Handle uniqueness collisions: retry with new codes (PDR §11)
   - Return array of created tokens (id, code, expiresAt, label)

2. **`GET /api/admin/tokens`**:
   - Query params: `eventId?`, `status?` (unused/redeemed/expired/revoked), `search?` (partial code or label match), `page`, `limit` (default 50)
   - Status is computed from model fields:
     - `revoked`: `isRevoked === true`
     - `expired`: `expiresAt < now && !isRevoked`
     - `redeemed`: `redeemedAt !== null && !isRevoked && expiresAt >= now`
     - `unused`: `redeemedAt === null && !isRevoked && expiresAt >= now`

3. **`GET /api/admin/events/:id/tokens`**:
   - Same as above but filtered by eventId

4. **`PATCH /api/admin/tokens/:id/revoke`**:
   - Set `isRevoked = true`, `revokedAt = now()`
   - Return updated token

5. **`PATCH /api/admin/tokens/:id/unrevoke`**:
   - Set `isRevoked = false`, `revokedAt = null`
   - Only if token has not expired
   - Return updated token

6. **`POST /api/admin/tokens/bulk-revoke`**:
   - Body: `{ tokenIds: string[] }`
   - Use Prisma transaction to update all
   - Return count of revoked tokens

7. **`GET /api/admin/events/:id/tokens/export`**:
   - Return CSV with headers: `Code,Event Title,Expires At,Label,Status`
   - Set `Content-Type: text/csv` and `Content-Disposition: attachment; filename="tokens-{eventTitle}.csv"`

8. **`GET /api/admin/dashboard`**:
   - Return summary stats:
     ```json
     {
       "activeEvents": 5,
       "totalTokens": 1200,
       "tokenBreakdown": { "unused": 800, "redeemed": 300, "expired": 50, "revoked": 50 },
       "upcomingEvents": [{ "id": "...", "title": "...", "startsAt": "..." }]
     }
     ```

**Commit**: `P-06: Implement admin token management API (generate, list, revoke, export)`

---

#### P-07: Implement public token validation API route

**Depends on**: P-03, P-02

**Objective**: Create the `POST /api/tokens/validate` endpoint and `GET /api/events/:id/status` endpoint (PDR §10.1).

**Files to create**:
```
platform/src/app/api/
├── tokens/
│   └── validate/route.ts     # POST — validate access code, issue JWT
├── events/
│   └── [id]/
│       └── status/route.ts   # GET — event status check with stream probing
└── lib/
    └── stream-probe.ts       # Probe HLS server for live status
```

**Implementation Details**:

1. **`POST /api/tokens/validate`**:
   - Body: `{ code: string }`
   - Input validation: sanitize code (alphanumeric only, trim whitespace)
   - Rate limit: 5/min per IP (PDR §12)
   - Check all five access rules (PDR §5.4):
     1. Code exists in DB
     2. `isRevoked === false`
     3. `event.isActive === true`
     4. `now <= expiresAt`
     5. No active session exists for this token (single-device enforcement, PDR §5.3)
   - Tiered error responses (PDR §7.1):
     - Unknown code → `401 { error: "Invalid code. Please check your ticket and try again." }`
     - Expired → `410 { error: "This code has expired. Access was available until [date]." }`
     - Revoked → `403 { error: "This code has been revoked. Please contact the event organizer." }`
     - Event deactivated → `403 { error: "This event is no longer available." }`
     - Token in use → `409 { error: "This access code is currently in use on another device.", inUse: true }`
   - On success:
     - If first use: set `redeemedAt = now`, `redeemedIp = request IP`
     - Create active session record via `createSession()` (P-03)
     - Mint JWT playback token with session ID (P-03)
     - Probe HLS server for live status (see stream-probe details below)
     - Return `TokenValidationResponse` (PDR §10.1)

2. **`src/lib/stream-probe.ts`**:
   - Mint a short-lived probe JWT (10s expiry, `probe: true`)
   - Send `HEAD` to `HLS_SERVER_BASE_URL/streams/:eventId/stream.m3u8` with probe JWT
   - Check response for `Last-Modified` or `ETag` headers
   - If probe succeeds + manifest recently updated → `isLive = true`
   - If probe fails → fall back to time-based check: `isLive = (now >= startsAt && now <= endsAt)`

3. **`GET /api/events/:id/status`**:
   - Query param: `code` (required)
   - Validate code belongs to event (lightweight check, no rate limit)
   - Probe stream status
   - Return `EventStatusResponse` (PDR §10.1)

**Commit**: `P-07: Implement public token validation and event status API routes`

---

#### P-08: Implement JWT playback refresh and revocation sync API routes

**Depends on**: P-03, P-07

**Objective**: Create the JWT refresh endpoint, session heartbeat/release endpoints, and the internal revocation sync endpoint (PDR §10.1, §10.3).

**Files to create**:
```
platform/src/app/api/
├── playback/
│   ├── refresh/route.ts      # POST — refresh JWT playback token
│   ├── heartbeat/route.ts    # POST — keep active session alive
│   └── release/route.ts      # POST — release active session
└── revocations/
    └── route.ts              # GET — internal revocation sync endpoint
```

**Implementation Details**:

1. **`POST /api/playback/refresh`**:
   - Auth: `Authorization: Bearer <current-JWT>` (required)
   - Rate limit: 12/hour per token code (extracted from JWT `sub`)
   - Flow:
     1. Verify JWT signature (using same `jose` verification)
     2. Extract `sub` (access code) and `sid` (session ID) from JWT claims
     3. Re-validate access code against DB (rules 1–4 from PDR §5.4)
     4. Verify the session ID from JWT matches the active session for this token
     5. If valid: mint new JWT with same `sid`, return `TokenRefreshResponse`
     6. If invalid: return appropriate error (same status codes as validate, except 409)
   - No request body — all information comes from the JWT

2. **`POST /api/playback/heartbeat`** (PDR §10.1):
   - Auth: `Authorization: Bearer <current-JWT>` (required)
   - Flow:
     1. Verify JWT signature
     2. Extract `sid` (session ID) from JWT claims
     3. Update `lastHeartbeat` timestamp via `updateHeartbeat(sid)` (P-03)
     4. If session not found → `404 { error: "Session not found" }`
     5. If session belongs to a different device (race condition) → `409 { error: "Session conflict" }`
     6. If success → `200 { ok: true }`
   - Player calls this every 30 seconds to keep the session alive
   - No rate limiting (lightweight operation)

3. **`POST /api/playback/release`** (PDR §10.1):
   - Auth: `Authorization: Bearer <current-JWT>` (required)
   - Flow:
     1. Verify JWT signature
     2. Extract `sid` (session ID) from JWT claims
     3. Delete the active session via `releaseSession(sid)` (P-03)
     4. Return `200 { released: true }`
   - Fire-and-forget from the client perspective — if request fails, session times out naturally
   - Called via `navigator.sendBeacon()` on page close

4. **`GET /api/revocations`**:
   - Auth: `X-Internal-Api-Key` header (must match `INTERNAL_API_KEY` env var)
   - Query param: `since` (required, ISO 8601 timestamp)
   - Response body (PDR §10.3):
     ```json
     {
       "revocations": [
         { "code": "...", "revokedAt": "..." }
       ],
       "eventDeactivations": [
         {
           "eventId": "...",
           "deactivatedAt": "...",
           "tokenCodes": ["...", "..."]
         }
       ],
       "serverTime": "..."
     }
     ```
   - Query for:
     - Tokens where `isRevoked = true AND revokedAt > since`
     - Events where `isActive = false AND updatedAt > since`
       - For each deactivated event, include all its token codes
   - Return `RevocationSyncResponse` from shared types

**Commit**: `P-08: Implement JWT refresh and internal revocation sync API routes`

---

### Stream: HLS Media Server (WS-H) — Phase 1

---

#### H-01: Initialize Express.js project with TypeScript

**Depends on**: S-03

**Objective**: Scaffold the Express.js server project with TypeScript strict mode and development tooling.

**Files to create**:
```
hls-server/
├── package.json
├── tsconfig.json             # Extend ../tsconfig.base.json
├── nodemon.json              # Dev hot-reload config
└── src/
    ├── index.ts              # Express app entry point
    ├── config.ts             # Environment variable validation
    └── types.ts              # Server-specific types
```

**Implementation Details**:

1. Install:
   ```bash
   npm install express cors jose
   npm install -D typescript @types/express @types/cors @types/node nodemon ts-node
   ```

2. **`package.json`**:
   ```json
   {
     "name": "@streaming/hls-server",
     "version": "1.0.0",
     "private": true,
     "scripts": {
       "dev": "nodemon",
       "build": "tsc",
       "start": "node dist/index.js",
       "typecheck": "tsc --noEmit"
     },
     "dependencies": {
       "@streaming/shared": "workspace:*",
       "express": "^4.18.0",
       "cors": "^2.8.5",
       "jose": "^5.0.0"
     }
   }
   ```

3. **`src/config.ts`**:
   ```typescript
   function requireEnv(name: string): string {
     const value = process.env[name];
     if (!value) throw new Error(`Missing required env: ${name}`);
     return value;
   }

   export function loadConfig() {
     const streamRoot = process.env.STREAM_ROOT;
     const upstreamOrigin = process.env.UPSTREAM_ORIGIN;

     // PDR §6.3: must have at least one content source
     if (!streamRoot && !upstreamOrigin) {
       throw new Error(
         'Configuration error: At least one of STREAM_ROOT or UPSTREAM_ORIGIN must be set.'
       );
     }

     return {
       port: parseInt(process.env.PORT || '4000', 10),
       playbackSigningSecret: requireEnv('PLAYBACK_SIGNING_SECRET'),
       platformAppUrl: requireEnv('PLATFORM_APP_URL'),
       internalApiKey: requireEnv('INTERNAL_API_KEY'),
       streamRoot: streamRoot || null,
       upstreamOrigin: upstreamOrigin || null,
       segmentCacheRoot: process.env.SEGMENT_CACHE_ROOT
         || (streamRoot ? `${streamRoot}/cache` : null),
       segmentCacheMaxSizeGb: parseFloat(process.env.SEGMENT_CACHE_MAX_SIZE_GB || '50'),
       segmentCacheMaxAgeHours: parseInt(process.env.SEGMENT_CACHE_MAX_AGE_HOURS || '72', 10),
       revocationPollIntervalMs: parseInt(
         process.env.REVOCATION_POLL_INTERVAL_MS || '30000', 10
       ),
       corsAllowedOrigin: requireEnv('CORS_ALLOWED_ORIGIN'),
     };
   }

   export type ServerConfig = ReturnType<typeof loadConfig>;
   ```

4. **`src/index.ts`**: Minimal Express app with health check:
   ```typescript
   import express from 'express';
   import { loadConfig } from './config';

   const config = loadConfig();
   const app = express();

   app.get('/health', (req, res) => {
     res.json({ status: 'ok' });
   });

   app.listen(config.port, () => {
     console.log(`HLS Media Server listening on port ${config.port}`);
   });
   ```

5. **`nodemon.json`**:
   ```json
   {
     "watch": ["src"],
     "ext": "ts",
     "exec": "ts-node src/index.ts"
   }
   ```

**Commit**: `H-01: Initialize Express.js project with TypeScript and config validation`

---

#### H-02: Implement JWT validation middleware

**Depends on**: H-01

**Objective**: Create Express middleware that validates JWT playback tokens on every streaming request (PDR §5.4, §6.2).

**Files to create**:
```
hls-server/src/
├── middleware/
│   ├── jwt-auth.ts           # JWT validation middleware
│   └── cors-config.ts        # CORS configuration
└── services/
    └── jwt-verifier.ts       # JWT verification service
```

**Implementation Details**:

1. **`src/services/jwt-verifier.ts`**:
   ```typescript
   import { jwtVerify } from 'jose';
   import { PlaybackTokenClaims, JWT_ALGORITHM, isPathAllowed } from '@streaming/shared';
   import type { ServerConfig } from '../config';

   export class JwtVerifier {
     private readonly secret: Uint8Array;

     constructor(config: ServerConfig) {
       this.secret = new TextEncoder().encode(config.playbackSigningSecret);
     }

     /**
      * Verify JWT and validate path access (PDR §5.4).
      * Returns decoded claims if valid, or throws with a generic error.
      */
     async verify(token: string, requestPath: string): Promise<PlaybackTokenClaims> {
       // Step 1-3: Verify signature and expiry
       const { payload } = await jwtVerify(this.secret, { algorithms: [JWT_ALGORITHM] });
       const claims = payload as unknown as PlaybackTokenClaims;

       // Step 4: Path prefix match
       if (!isPathAllowed(requestPath, claims.sp)) {
         throw new Error('Access denied');
       }

       // Step 5: Probe JWT restrictions (HEAD only)
       // This is handled in the middleware layer

       return claims;
     }
   }
   ```

2. **`src/middleware/jwt-auth.ts`**:
   - Extract JWT from:
     1. `Authorization: Bearer <JWT>` header (preferred)
     2. `__token` query parameter (Safari fallback, PDR §6.2)
     - Header takes priority if both present
   - Verify JWT using `JwtVerifier`
   - Check `sub` against revocation cache (injected dependency)
   - If probe JWT (`probe: true`): only allow HEAD method
   - On failure: return `401` (missing/malformed) or `403` (invalid/expired/revoked)
   - On success: attach decoded claims to `req` (via typed `res.locals`)
   - **Strip `__token` from any logging** (PDR §12, point 12)

3. **`src/middleware/cors-config.ts`**:
   ```typescript
   import cors from 'cors';
   import { CORS_MAX_AGE_SECONDS } from '@streaming/shared';
   import type { ServerConfig } from '../config';

   export function createCorsMiddleware(config: ServerConfig) {
     return cors({
       origin: config.corsAllowedOrigin,
       methods: ['GET', 'HEAD', 'OPTIONS'],
       allowedHeaders: ['Authorization', 'Range'],
       maxAge: CORS_MAX_AGE_SECONDS,
     });
   }
   ```

**Commit**: `H-02: Implement JWT validation middleware with Safari fallback and CORS`

---

#### H-03: Implement revocation cache and sync service

**Depends on**: H-01

**Objective**: Create the in-memory revocation cache and the background polling service that syncs with the Platform App (PDR §4.4).

**Files to create**:
```
hls-server/src/services/
├── revocation-cache.ts       # In-memory Map<string, number>
└── revocation-sync.ts        # Background polling service
```

**Implementation Details**:

1. **`src/services/revocation-cache.ts`**:
   ```typescript
   /**
    * In-memory revocation cache (PDR §4.4).
    * Maps revoked access token codes to their revocation timestamps.
    */
   export class RevocationCache {
     private readonly cache = new Map<string, number>();

     /** Check if a token code is revoked. */
     isRevoked(code: string): boolean {
       return this.cache.has(code);
     }

     /** Add a revoked code to the cache. */
     add(code: string, revokedAtMs: number): void {
       this.cache.set(code, revokedAtMs);
     }

     /** Add multiple revoked codes at once. */
     addBatch(entries: Array<{ code: string; revokedAtMs: number }>): void {
       for (const entry of entries) {
         this.cache.set(entry.code, entry.revokedAtMs);
       }
     }

     /** Remove entries older than maxAgeMs (expired tokens no longer need tracking). */
     evictOlderThan(maxAgeMs: number): number {
       const cutoff = Date.now() - maxAgeMs;
       let evicted = 0;
       for (const [code, timestamp] of this.cache) {
         if (timestamp < cutoff) {
           this.cache.delete(code);
           evicted++;
         }
       }
       return evicted;
     }

     /** Current cache size (for health endpoint). */
     get size(): number {
       return this.cache.size;
     }
   }
   ```

2. **`src/services/revocation-sync.ts`**:
   ```typescript
   import { RevocationSyncResponse } from '@streaming/shared';
   import { RevocationCache } from './revocation-cache';
   import type { ServerConfig } from '../config';

   /**
    * Background service that polls Platform App for revocations (PDR §4.4).
    */
   export class RevocationSyncService {
     private lastSyncTimestamp: string;
     private lastSuccessfulSync: number = Date.now();
     private intervalId: ReturnType<typeof setInterval> | null = null;
     private readonly cache: RevocationCache;
     private readonly config: ServerConfig;

     constructor(cache: RevocationCache, config: ServerConfig) {
       this.cache = cache;
       this.config = config;
       this.lastSyncTimestamp = new Date(0).toISOString(); // start from epoch
     }

     /** Start the background polling loop. */
     start(): void {
       // Initial sync immediately
       this.sync();
       // Then poll at configured interval
       this.intervalId = setInterval(
         () => this.sync(),
         this.config.revocationPollIntervalMs,
       );
     }

     /** Stop polling. */
     stop(): void {
       if (this.intervalId) {
         clearInterval(this.intervalId);
         this.intervalId = null;
       }
     }

     /** Perform a single sync cycle. */
     private async sync(): Promise<void> {
       try {
         const url = new URL('/api/revocations', this.config.platformAppUrl);
         url.searchParams.set('since', this.lastSyncTimestamp);

         const response = await fetch(url.toString(), {
           headers: {
             'X-Internal-Api-Key': this.config.internalApiKey,
           },
         });

         if (!response.ok) {
           console.error(`Revocation sync failed: HTTP ${response.status}`);
           this.checkSyncHealth();
           return;
         }

         const data: RevocationSyncResponse = await response.json();

         // Add individually revoked tokens
         for (const rev of data.revocations) {
           this.cache.add(rev.code, new Date(rev.revokedAt).getTime());
         }

         // Add tokens from deactivated events
         for (const deactivation of data.eventDeactivations) {
           const ts = new Date(deactivation.deactivatedAt).getTime();
           for (const code of deactivation.tokenCodes) {
             this.cache.add(code, ts);
           }
         }

         this.lastSyncTimestamp = data.serverTime;
         this.lastSuccessfulSync = Date.now();
       } catch (error) {
         console.error('Revocation sync error:', error);
         this.checkSyncHealth();
       }
     }

     /** Alert if sync has been failing for too long (PDR §4.4: alert after 5 min). */
     private checkSyncHealth(): void {
       const failureDuration = Date.now() - this.lastSuccessfulSync;
       if (failureDuration > 5 * 60 * 1000) {
         console.error(
           `ALERT: Revocation sync has been failing for ${Math.floor(failureDuration / 1000)}s`
         );
       }
     }

     /** Seconds since last successful sync (for health endpoint). */
     get lastSyncAgoSeconds(): number {
       return Math.floor((Date.now() - this.lastSuccessfulSync) / 1000);
     }
   }
   ```

**Commit**: `H-03: Implement in-memory revocation cache and background sync service`

---

#### H-04: Implement local file serving (Mode A)

**Depends on**: H-02

**Objective**: Serve HLS manifests (`.m3u8`) and segments (`.ts`, `.fmp4`) from a local filesystem directory (PDR §6.3 Mode A).

**Files to create**:
```
hls-server/src/
├── services/
│   └── content-resolver.ts   # Resolves content source (local/proxy/hybrid)
├── routes/
│   └── streams.ts            # GET /streams/:eventId/* route handler
└── utils/
    └── path-safety.ts        # Path traversal prevention
```

**Implementation Details**:

1. **`src/utils/path-safety.ts`**:
   ```typescript
   import path from 'node:path';

   /**
    * Sanitize and resolve a requested file path to prevent path traversal attacks.
    * Returns the resolved absolute path, or null if the path is unsafe.
    */
   export function resolveSecurePath(root: string, requestedPath: string): string | null {
     const resolved = path.resolve(root, requestedPath);
     // Ensure resolved path stays within root
     if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
       return null;
     }
     return resolved;
   }
   ```

2. **`src/services/content-resolver.ts`**:
   ```typescript
   import fs from 'node:fs/promises';
   import path from 'node:path';
   import type { ServerConfig } from '../config';
   import { resolveSecurePath } from '../utils/path-safety';

   export class ContentResolver {
     constructor(private readonly config: ServerConfig) {}

     /**
      * Attempt to resolve a content file from local storage.
      * Returns the absolute file path if found, null otherwise.
      */
     async resolveLocal(eventId: string, filename: string): Promise<string | null> {
       if (!this.config.streamRoot) return null;

       const filePath = resolveSecurePath(
         this.config.streamRoot,
         path.join(eventId, filename),
       );
       if (!filePath) return null;

       try {
         await fs.access(filePath);
         return filePath;
       } catch {
         return null;
       }
     }

     /**
      * Attempt to resolve from the segment cache.
      */
     async resolveCache(eventId: string, filename: string): Promise<string | null> {
       if (!this.config.segmentCacheRoot) return null;

       const filePath = resolveSecurePath(
         this.config.segmentCacheRoot,
         path.join(eventId, filename),
       );
       if (!filePath) return null;

       try {
         await fs.access(filePath);
         return filePath;
       } catch {
         return null;
       }
     }

     /** Get the content mode based on config. */
     get mode(): 'local' | 'proxy' | 'hybrid' {
       if (this.config.streamRoot && this.config.upstreamOrigin) return 'hybrid';
       if (this.config.streamRoot) return 'local';
       return 'proxy';
     }
   }
   ```

3. **`src/routes/streams.ts`**:
   - Route: `GET /streams/:eventId/*`
   - Apply JWT auth middleware (from H-02)
   - Resolve `eventId` and `filename` from URL params
   - Validate file extension: only `.m3u8`, `.ts`, `.fmp4` allowed
   - Use `ContentResolver.resolveLocal()` to find the file
   - Set appropriate MIME types:
     - `.m3u8` → `application/vnd.apple.mpegurl`
     - `.ts` → `video/mp2t`
     - `.fmp4` → `video/mp4`
   - Stream the file to response using `fs.createReadStream()`
   - 404 if file not found

**Commit**: `H-04: Implement local file serving for HLS content with path safety`

---

#### H-05: Implement upstream proxy with persistent caching (Mode B)

**Depends on**: H-04

**Objective**: Fetch HLS content from an upstream origin and persistently cache segments locally (PDR §6.3 Mode B).

**Files to create**:
```
hls-server/src/services/
├── upstream-proxy.ts         # Fetch from upstream origin
├── segment-cache.ts          # Cache management (write, LRU eviction)
└── inflight-dedup.ts         # In-flight deduplication
```

**Implementation Details**:

1. **`src/services/inflight-dedup.ts`**:
   ```typescript
   /**
    * Prevents duplicate concurrent fetches for the same upstream segment (PDR §6.3).
    * When multiple viewers request the same uncached segment simultaneously,
    * only one upstream fetch is initiated.
    */
   export class InflightDeduplicator {
     private readonly inflight = new Map<string, Promise<Buffer>>();

     /**
      * Get or initiate a fetch. If a fetch for this key is already in-flight,
      * returns the existing promise. Otherwise, executes the fetcher and
      * shares the result with all concurrent callers.
      */
     async getOrFetch(key: string, fetcher: () => Promise<Buffer>): Promise<Buffer> {
       const existing = this.inflight.get(key);
       if (existing) return existing;

       const promise = fetcher().finally(() => {
         this.inflight.delete(key);
       });

       this.inflight.set(key, promise);
       return promise;
     }
   }
   ```

2. **`src/services/upstream-proxy.ts`**:
   ```typescript
   import type { ServerConfig } from '../config';

   export class UpstreamProxy {
     constructor(private readonly config: ServerConfig) {}

     /**
      * Construct the upstream URL for a given event and filename.
      * Convention: UPSTREAM_ORIGIN/:eventId/:filename (PDR §6.3)
      */
     buildUpstreamUrl(eventId: string, filename: string): string {
       return `${this.config.upstreamOrigin}/${eventId}/${filename}`;
     }

     /**
      * Fetch a file from the upstream origin.
      * Returns the response buffer and relevant headers.
      */
     async fetch(eventId: string, filename: string): Promise<{
       data: Buffer;
       contentType: string;
       lastModified?: string;
       etag?: string;
     }> {
       const url = this.buildUpstreamUrl(eventId, filename);
       const response = await fetch(url);

       if (!response.ok) {
         throw new Error(`Upstream returned ${response.status}`);
       }

       const data = Buffer.from(await response.arrayBuffer());
       return {
         data,
         contentType: response.headers.get('content-type') || 'application/octet-stream',
         lastModified: response.headers.get('last-modified') || undefined,
         etag: response.headers.get('etag') || undefined,
       };
     }
   }
   ```

3. **`src/services/segment-cache.ts`**:
   ```typescript
   import fs from 'node:fs/promises';
   import path from 'node:path';
   import type { ServerConfig } from '../config';
   import { resolveSecurePath } from '../utils/path-safety';

   export class SegmentCache {
     constructor(private readonly config: ServerConfig) {}

     /**
      * Write a segment to the persistent cache (PDR §6.3).
      */
     async write(eventId: string, filename: string, data: Buffer): Promise<void> {
       if (!this.config.segmentCacheRoot) return;

       const dirPath = resolveSecurePath(this.config.segmentCacheRoot, eventId);
       if (!dirPath) return;

       await fs.mkdir(dirPath, { recursive: true });

       const filePath = path.join(dirPath, path.basename(filename));
       await fs.writeFile(filePath, data);

       // Queue async eviction check (does not block response — PDR §6.3)
       this.checkDiskUsage().catch(err =>
         console.error('Cache eviction check failed:', err)
       );
     }

     /**
      * Check cache size and perform LRU eviction if needed (PDR §6.3).
      */
     private async checkDiskUsage(): Promise<void> {
       // Implementation: walk segmentCacheRoot, sum file sizes,
       // if > segmentCacheMaxSizeGb, evict least-recently-accessed files
       // using file atime. Details in H-10 (cleanup task).
     }

     /**
      * Delete all cached segments for a specific event.
      * Used by DELETE /admin/cache/:eventId (PDR §6.3).
      */
     async clearEvent(eventId: string): Promise<void> {
       if (!this.config.segmentCacheRoot) return;

       const dirPath = resolveSecurePath(this.config.segmentCacheRoot, eventId);
       if (!dirPath) return;

       await fs.rm(dirPath, { recursive: true, force: true });
     }
   }
   ```

4. Update **`src/routes/streams.ts`** to integrate the full content resolution pipeline:
   - Check order (PDR §6.3):
     1. Local file (`STREAM_ROOT/:eventId/`)
     2. Cached segment (`SEGMENT_CACHE_ROOT/:eventId/`)
     3. Upstream fetch (+ write to cache)
   - For `.m3u8` in proxy mode: **never cache live manifests** (always re-fetch)
   - Use `InflightDeduplicator` for concurrent segment requests

**Commit**: `H-05: Implement upstream proxy with persistent caching and in-flight dedup`

---

#### H-06: Implement health endpoint and structured logging

**Depends on**: H-03, H-04

**Objective**: Create the health check endpoint and structured JSON request logging (PDR §6.6).

**Files to create**:
```
hls-server/src/
├── routes/
│   ├── health.ts             # GET /health
│   └── admin-cache.ts        # DELETE /admin/cache/:eventId
├── middleware/
│   └── request-logger.ts     # Structured JSON logging
└── utils/
    └── hash.ts               # Token code hashing for logs
```

**Implementation Details**:

1. **`GET /health`** (PDR §6.6):
   - No auth required
   - Response:
     ```json
     {
       "status": "ok",
       "revocationCacheSize": 42,
       "lastSyncAgo": "25s",
       "segmentCacheEvents": 5,
       "segmentCacheSizeMB": 1234
     }
     ```

2. **`DELETE /admin/cache/:eventId`**:
   - Auth: `X-Internal-Api-Key` header
   - Calls `SegmentCache.clearEvent(eventId)`
   - Returns 204 on success

3. **`src/middleware/request-logger.ts`**:
   - Log format (JSON): `{ method, path, tokenCode (SHA-256 hashed), status, responseTimeMs, clientIp, timestamp }`
   - **Never log raw token codes** (PDR §12)
   - Strip `__token` query param from logged paths

4. **`src/utils/hash.ts`**:
   ```typescript
   import crypto from 'node:crypto';

   /** Hash a token code for safe logging (PDR §12). Never log raw codes. */
   export function hashForLog(value: string): string {
     return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
   }
   ```

5. Wire everything together in `src/index.ts`:
   - Apply CORS middleware
   - Apply request logger
   - Mount stream routes with JWT auth
   - Mount health route (no auth)
   - Mount admin cache route (API key auth)
   - Start revocation sync service
   - Graceful shutdown: stop sync service on SIGTERM/SIGINT

**Commit**: `H-06: Add health endpoint, admin cache clear, and structured request logging`

---

## 5. Phase 2 — Feature Implementation

> **Continue parallel streams. Each stream builds user-facing features on top of Phase 1 core.**

---

### Stream: Platform App (WS-P) — Phase 2

---

#### P-09: Install and configure shadcn/ui component library

**Depends on**: P-01

**Objective**: Set up shadcn/ui with the required base components (PDR §15).

**Commands**:
```bash
cd platform
npx shadcn-ui@latest init
npx shadcn-ui@latest add button input card alert badge dialog table toast
npx shadcn-ui@latest add slider dropdown-menu tabs separator scroll-area
```

**Files created** (by shadcn CLI):
```
platform/src/
├── components/
│   └── ui/
│       ├── button.tsx
│       ├── input.tsx
│       ├── card.tsx
│       ├── alert.tsx
│       ├── badge.tsx
│       ├── dialog.tsx
│       ├── table.tsx
│       ├── toast.tsx (+ toaster.tsx, use-toast.ts)
│       ├── slider.tsx
│       ├── dropdown-menu.tsx
│       ├── tabs.tsx
│       ├── separator.tsx
│       └── scroll-area.tsx
├── lib/
│   └── utils.ts              # cn() utility (shadcn default)
```

**Additional**:
- Install Lucide icons: `npm install lucide-react`
- Install Framer Motion: `npm install framer-motion`

**Commit**: `P-09: Install shadcn/ui components, Lucide icons, and Framer Motion`

---

#### P-10: Build Viewer Portal — Token Entry Screen

**Depends on**: P-09

**Objective**: Create the public token entry page with the dark cinematic design (PDR §7.1, §14).

**Files to create**:
```
platform/src/
├── app/
│   └── page.tsx              # Token entry page (replace placeholder)
├── components/
│   └── viewer/
│       ├── token-entry.tsx   # Token entry form component
│       └── error-message.tsx # Tiered error display
└── lib/
    └── api-client.ts         # Client-side API helper (fetch wrapper)
```

**Implementation Details**:

1. **`page.tsx`** — Root page layout:
   - Dark cinematic background (`cinema-black`)
   - Centered card layout
   - Responsive: full-width on mobile, `max-w-md` on desktop (PDR §15.5)

2. **`token-entry.tsx`**:
   - `Input` component: monospace font (`font-mono`), uppercase display via CSS `text-transform: uppercase`, auto-trim whitespace on submit
   - `Button` component: "Watch Now" with loading state (Loader2 spinner → checkmark animation)
   - Submit handler:
     1. Sanitize input (alphanumeric only, client-side pre-check)
     2. Call `POST /api/tokens/validate` via fetch
     3. On success: transition to player (store JWT + event data in React state, NOT localStorage for security)
     4. On error: show tiered error message (PDR §7.1)
   - Subtle helper text: "Enter the code from your ticket"
   - Application branding area at top (configurable via `NEXT_PUBLIC_APP_NAME`)

3. **`error-message.tsx`**:
   - Map HTTP status codes to user-friendly messages:
     - `401` → "Invalid code. Please check your ticket and try again."
     - `409` → "This access code is currently being viewed on another device. Please wait for the other session to end before trying again."
     - `410` → "This code has expired. Access was available until [date]."
     - `403` → "This code has been revoked. Please contact the event organizer." or "This event is no longer available."
     - `429` → "Too many attempts. Please wait a moment and try again."
   - For `409`: show an informational style (not error-red) since the code is valid but in use
   - Red border on input, error text below with fade-in animation

4. **`api-client.ts`**:
   ```typescript
   export async function validateToken(code: string): Promise<TokenValidationResponse> { ... }
   export async function refreshPlaybackToken(jwt: string): Promise<TokenRefreshResponse> { ... }
   export async function sendHeartbeat(jwt: string): Promise<HeartbeatResponse> { ... }
   export async function releaseSession(jwt: string): Promise<void> { ... }
   export async function getEventStatus(eventId: string, code: string): Promise<EventStatusResponse> { ... }
   ```

**Commit**: `P-10: Build Viewer Portal token entry screen with dark cinematic theme`

---

#### P-11: Build HTML5 video player component

**Depends on**: P-09

**Objective**: Create the custom HTML5 video player with hls.js integration and playback controls (PDR §9).

**Files to create**:
```
platform/src/components/player/
├── video-player.tsx          # Main player container
├── video-controls.tsx        # Control bar with auto-hide
├── play-pause-button.tsx     # Play/pause with morph animation
├── volume-control.tsx        # Volume slider + mute toggle
├── progress-bar.tsx          # Seek bar with time preview
├── time-display.tsx          # Current / Duration display
├── fullscreen-toggle.tsx     # Fullscreen API toggle
├── quality-selector.tsx      # HLS quality level selector
├── pip-toggle.tsx            # Picture-in-Picture toggle
├── live-badge.tsx            # Pulsing "LIVE" indicator
└── loading-overlay.tsx       # Buffering spinner overlay
```

**Implementation Details**:

1. Install: `npm install hls.js`

2. **`video-player.tsx`** — Main orchestrator:
   - Accept props: `streamUrl`, `playbackToken`, `event` metadata
   - Detect Safari vs other browsers (PDR §7.2):
     ```typescript
     const isSafariNative = () =>
       navigator.vendor?.includes('Apple') &&
       document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
     ```
   - **Non-Safari path**: Initialize hls.js with `xhrSetup` for JWT injection:
     ```typescript
     hls.config.xhrSetup = (xhr) => {
       xhr.setRequestHeader('Authorization', `Bearer ${currentToken}`);
     };
     ```
   - **Safari path**: Append `__token=<JWT>` to the manifest URL and use native `<video>` element
   - Handle hls.js error events: on `403` segment error → attempt one JWT refresh → show revocation overlay if refresh fails
   - Video element: `ref`, `autoPlay`, `playsInline` attributes

3. **`video-controls.tsx`**:
   - Framer Motion auto-hide: visible on mouse move, fade out after 3 seconds of inactivity
   - Mobile: tap to show/hide, always visible with translucent background
   - Layout: progress bar full-width on top, controls row below
   - Keyboard shortcuts (PDR §13.4): Space (play/pause), F (fullscreen), M (mute), Arrow keys

4. **`play-pause-button.tsx`**: Icon morphs between `Play` → `Pause` with 100ms rotation animation

5. **`volume-control.tsx`**:
   - `Volume2` / `VolumeX` icons
   - Slider appears on hover (desktop) or as popover (mobile)
   - Persist mute state to localStorage (PDR §9.4)

6. **`progress-bar.tsx`**:
   - `Slider` component with custom track styling
   - Time tooltip on hover showing position
   - Live mode: hide seek bar or constrain to DVR window
   - Double-tap to seek ±10s on mobile

7. **`time-display.tsx`**: Format as `MM:SS` or `HH:MM:SS` for videos ≥ 1 hour (JetBrains Mono font)

8. **`fullscreen-toggle.tsx`**: `Maximize` / `Minimize` icons, use Fullscreen API, handle double-click on video

9. **`quality-selector.tsx`**: Dropdown showing "Auto" + available renditions from hls.js levels (PDR §9.7)

10. **`pip-toggle.tsx`**: Picture-in-Picture API toggle, hide if not supported

11. **`live-badge.tsx`**: Pulsing red dot animation, "LIVE" text (PDR §14.3)

12. **`loading-overlay.tsx`**: Centered `Loader2` spinner, visible during buffering

**Commit**: `P-11: Build HTML5 video player with hls.js, controls, and Safari fallback`

---

#### P-12: Build Player Screen with JWT refresh and expiry handling

**Depends on**: P-10, P-11

**Objective**: Create the full player screen that wraps the video player with event metadata, JWT auto-refresh, and access expiry management (PDR §7.2).

**Files to create**:
```
platform/src/
├── components/
│   └── viewer/
│       ├── player-screen.tsx     # Full player page with metadata header
│       ├── expiry-warning.tsx    # Toast notification for upcoming expiry
│       ├── access-ended.tsx      # Overlay for expired/revoked access
│       └── pre-event-screen.tsx  # Countdown before event starts (PDR §7.3)
└── hooks/
    ├── use-jwt-refresh.ts        # Auto-refresh JWT every 50 minutes
    ├── use-session-heartbeat.ts  # Send heartbeat every 30 seconds (PDR §5.3)
    ├── use-session-release.ts    # Release session on page close (PDR §7.2)
    ├── use-event-status.ts       # Poll event status for pre-event screen
    └── use-expiry-countdown.ts   # Track time-to-expiry for warnings
```

**Implementation Details**:

1. **`player-screen.tsx`**:
   - Layout: Full-viewport video player with header bar above
   - Header shows: event title, live badge (if live), expiry countdown (if < 6 hours)
   - Three states: pre-event → playing → access-ended

2. **`use-jwt-refresh.ts`**:
   - Set timer at `tokenExpiresIn - 600` seconds (50 minutes of 60-minute JWT)
   - Call `POST /api/playback/refresh` with current JWT as Bearer
   - On success: update JWT in state (seamless to user)
   - On failure: transition to access-ended state
   - Provide `currentToken` getter for hls.js `xhrSetup`

3. **`use-session-heartbeat.ts`** (PDR §5.3, §7.2):
   - Send `POST /api/playback/heartbeat` every 30 seconds with current JWT
   - On `404` response (session timed out): pause playback, show overlay "Your session has expired due to inactivity. Please re-enter your access code."
   - On `409` response (session taken by another device): pause playback, show overlay "Your session has been started on another device."
   - On network error: continue playing (session will time out naturally if heartbeat keeps failing)

4. **`use-session-release.ts`** (PDR §7.2):
   - Register `beforeunload` and `visibilitychange` event handlers
   - On page close / navigation away: call `POST /api/playback/release` via `navigator.sendBeacon()` (or `fetch` with `keepalive: true`)
   - Fire-and-forget — if release fails, session times out after `SESSION_TIMEOUT_SECONDS` (default: 60s)
   - Cleanup: remove event handlers on component unmount

5. **`use-event-status.ts`**:
   - Poll `GET /api/events/:id/status?code=<code>` every 30 seconds (PDR §7.3)
   - When status changes to `live` → auto-transition to player

6. **`use-expiry-countdown.ts`**:
   - Track `expiresAt` from validation response
   - Show toast warning at 15 minutes before expiry (PDR §11)
   - On expiry: 60-second grace period, then show access-ended overlay

7. **`pre-event-screen.tsx`**:
   - Event title, description, poster image
   - Countdown timer to `startsAt` (smooth number transition)
   - Auto-transition when stream goes live

8. **`access-ended.tsx`**:
   - Semi-transparent overlay on top of player
   - Message varies: "Your access has ended" / "Your access has been revoked" / "Your session has been started on another device." / "This event is no longer available"
   - Back button to return to token entry

**Commit**: `P-12: Build player screen with JWT auto-refresh, session heartbeat/release, pre-event, and expiry handling`

---

#### P-13: Build Admin Console — Login page

**Depends on**: P-09, P-04

**Objective**: Create the admin login page at `/admin` (PDR §8.1).

**Files to create**:
```
platform/src/app/admin/
├── layout.tsx                # Admin layout (sidebar + main content)
├── page.tsx                  # Dashboard (redirects to login if not authenticated)
└── login/
    └── page.tsx              # Admin login form
platform/src/components/admin/
├── admin-sidebar.tsx         # Navigation sidebar (Events, Tokens)
├── login-form.tsx            # Password input + submit
└── admin-header.tsx          # Header with logout button
```

**Implementation Details**:

1. **`login/page.tsx`**:
   - Clean, light-themed login form (PDR §14.1 admin palette)
   - Single password field, "Sign In" button
   - Error state for invalid credentials
   - On success: redirect to `/admin` (dashboard)

2. **`layout.tsx`** — Admin layout:
   - Check session status (client-side check via API call)
   - If not authenticated: redirect to `/admin/login`
   - If authenticated: show sidebar + main content area

3. **`admin-sidebar.tsx`**:
   - Navigation links: Events, Tokens
   - Application branding at top
   - Logout button at bottom

**Commit**: `P-13: Build admin console login page and layout with sidebar navigation`

---

#### P-14: Build Admin Console — Event Management UI

**Depends on**: P-13, P-05

**Objective**: Create the event management pages for listing, creating, editing, and managing events (PDR §8.3).

**Files to create**:
```
platform/src/
├── app/admin/events/
│   ├── page.tsx                          # Event list page
│   ├── new/page.tsx                      # Create event page
│   └── [id]/
│       ├── page.tsx                      # Event detail page
│       └── edit/page.tsx                 # Edit event page
├── components/admin/
│   ├── event-list.tsx                    # Event table with filters/sort
│   ├── event-form.tsx                    # Create/Edit event form
│   ├── event-detail.tsx                  # Single event view with actions
│   ├── event-status-badge.tsx            # Active/Inactive/Archived badge
│   ├── deactivate-dialog.tsx             # Confirmation dialog
│   ├── archive-dialog.tsx                # Confirmation dialog
│   └── delete-event-dialog.tsx           # Two-step confirmation with title typing
```

**Implementation Details**:

1. **`event-list.tsx`**:
   - `Table` component with columns: Title, Source, Starts At, Ends At, Access Window, Status, Token Count, Actions
   - Filters: status dropdown (Active/Inactive/Archived), timeframe (Upcoming/Past)
   - Sort: by start date (default), title, token count
   - "Show archived" toggle (PDR §8.3)
   - Action buttons: Edit, Deactivate/Reactivate, Archive, Delete

2. **`event-form.tsx`**:
   - Fields: Title (required), Description (textarea), Stream URL Override (optional with help text), Poster URL, Start Date/Time, End Date/Time, Access Window (hours, default 48)
   - Client-side validation:
     - Start before End
     - Access Window 1–168 hours
     - URL format check if provided
   - Optional "Test Stream" button (HEAD request to HLS server)

3. **`delete-event-dialog.tsx`** (PDR §8.3):
   - Step 1: Warning dialog with event title and token count
   - Step 2: Text input requiring admin to type the event title to confirm
   - Confirmation header: `X-Confirm-Delete: <event-title>` sent with DELETE request

**Commit**: `P-14: Build admin event management UI (list, create, edit, delete, archive)`

---

#### P-15: Build Admin Console — Token Management UI

**Depends on**: P-13, P-06

**Objective**: Create the token management pages for generating, listing, searching, and revoking tokens (PDR §8.4).

**Files to create**:
```
platform/src/
├── app/admin/tokens/
│   └── page.tsx                          # Token list page (global)
├── components/admin/
│   ├── token-list.tsx                    # Token table with filters/search
│   ├── token-generate-dialog.tsx         # Generate tokens dialog
│   ├── token-status-badge.tsx            # Status badge (unused/redeemed/expired/revoked)
│   ├── token-revoke-dialog.tsx           # Single/bulk revoke confirmation
│   ├── token-export-button.tsx           # CSV export
│   └── token-code-display.tsx            # Monospace code with copy button
```

**Implementation Details**:

1. **`token-list.tsx`**:
   - `Table` with columns: Code (monospace), Event Title, Label, Status, Redeemed At, Expires At, Actions
   - Filters: by event (dropdown), by status (unused/redeemed/expired/revoked)
   - Search: partial code match or label match
   - Pagination: 50 per page (PDR §8.4)
   - Checkbox selection for bulk actions

2. **`token-generate-dialog.tsx`**:
   - Select event from dropdown
   - Count input (1–500)
   - Optional label/batch name
   - Results table showing generated codes with copy-to-clipboard buttons
   - Export button for bulk download

3. **`token-code-display.tsx`**:
   - JetBrains Mono font, letter-spacing 0.15em (PDR §14.2)
   - Copy button (`Copy` icon → `Check` icon on success)
   - One-click clipboard copy

4. **`token-export-button.tsx`**:
   - Triggers `GET /api/admin/events/:id/tokens/export`
   - Downloads CSV file

**Commit**: `P-15: Build admin token management UI (generate, list, search, revoke, export)`

---

#### P-16: Build Admin Console — Dashboard

**Depends on**: P-14, P-15

**Objective**: Create the admin dashboard home view with summary statistics (PDR §8.2).

**Files to create**:
```
platform/src/components/admin/
├── dashboard.tsx                   # Dashboard layout with cards
├── stat-card.tsx                   # Summary statistics card
└── upcoming-events.tsx             # Upcoming events timeline
```

**Implementation Details**:

1. **`dashboard.tsx`**:
   - Fetch data from `GET /api/admin/dashboard`
   - Summary cards: Total active events, Total tokens (breakdown), Upcoming events
   - Quick action buttons: Create Event, Generate Tokens

2. **`stat-card.tsx`**: Reusable card with title, number, breakdown (shadcn Card)

3. **`upcoming-events.tsx`**: Timeline view of next N upcoming events with title, date, token count

**Commit**: `P-16: Build admin dashboard with summary statistics and upcoming events`

---

### Stream: HLS Media Server (WS-H) — Phase 2

---

#### H-07: Implement segment cache cleanup and LRU eviction

**Depends on**: H-05

**Objective**: Create the periodic cleanup task and LRU eviction for the segment cache (PDR §6.3).

**Files to create**:
```
hls-server/src/services/
└── cache-cleanup.ts          # Periodic cleanup + LRU eviction service
```

**Implementation Details**:

1. **`src/services/cache-cleanup.ts`**:
   - Periodic task running every 6 hours (configurable)
   - Two-phase cleanup:
     1. **Age-based**: Remove segments older than `SEGMENT_CACHE_MAX_AGE_HOURS` (default 72)
     2. **Size-based (LRU)**: If cache still exceeds `SEGMENT_CACHE_MAX_SIZE_GB`, evict least-recently-accessed files (use `stat.atimeMs`) until below limit
   - Walk `SEGMENT_CACHE_ROOT` directory, collect file stats
   - Sort by `atime` for LRU eviction
   - Log cleanup results (files removed, space freed)
   - Track cache stats for health endpoint: total events, total size in MB

**Commit**: `H-07: Implement segment cache age-based cleanup and LRU eviction`

---

#### H-08: Implement manifest caching strategy and VOD detection

**Depends on**: H-05

**Objective**: Implement the manifest caching logic — never cache live manifests, cache VOD manifests for 24 hours (PDR §6.3).

**Files to modify/create**:
```
hls-server/src/services/
└── manifest-handler.ts       # Manifest-specific caching logic
```

**Implementation Details**:

1. **`src/services/manifest-handler.ts`**:
   - Detect live vs VOD:
     - Check for `#EXT-X-ENDLIST` tag in manifest content (VOD indicator)
     - If present → VOD → cache for 24 hours
     - If absent → live → always re-fetch from upstream
   - For local manifests: serve directly (no caching needed)
   - For proxied manifests: apply caching strategy before returning to client
   - Set appropriate Cache-Control headers:
     - Live manifests: `no-cache, no-store`
     - VOD manifests: `max-age=86400`

**Commit**: `H-08: Implement manifest caching strategy with live/VOD detection`

---

#### H-09: Add probe JWT support and HEAD request handling

**Depends on**: H-02

**Objective**: Support probe JWTs that restrict to HEAD requests only (PDR §10.1 `isLive` detection).

**Files to modify**:
```
hls-server/src/middleware/jwt-auth.ts  # Update to handle probe claim
hls-server/src/routes/streams.ts       # Return Last-Modified and ETag on HEAD
```

**Implementation Details**:

1. Update JWT auth middleware:
   - If JWT has `probe: true` claim and request method is not `HEAD` → reject with 403
   - If JWT has `probe: true` claim and request method is `HEAD` → allow (but don't serve content, just headers)

2. Update stream route handler:
   - For HEAD requests on `.m3u8` files: respond with `Last-Modified` and `ETag` headers (from file stat or upstream response headers)
   - For HEAD requests on segment files: respond with file size in `Content-Length`

**Commit**: `H-09: Add probe JWT support and HEAD request handling for stream probing`

---

#### H-10: Add comprehensive error handling and graceful shutdown

**Depends on**: H-06

**Objective**: Implement all error response patterns (PDR §6.5) and clean server lifecycle management.

**Files to create/modify**:
```
hls-server/src/
├── middleware/
│   └── error-handler.ts      # Global error handler
└── index.ts                  # Update with graceful shutdown
```

**Implementation Details**:

1. **`src/middleware/error-handler.ts`**:
   - Map internal errors to standard HTTP responses (PDR §6.5):
     - Missing/malformed auth → `401 { error: "Authorization required" }`
     - JWT invalid/expired/path-mismatch/revoked → `403 { error: "Access denied" }`
     - File not found → `404 { error: "Not found" }`
     - Upstream unreachable → `502 { error: "Stream source unavailable" }`
   - All error responses intentionally vague (no internal state leakage)
   - Catch async errors (wrap route handlers with async error catcher)

2. Graceful shutdown in `index.ts`:
   - Listen for `SIGTERM` and `SIGINT`
   - Stop revocation sync service
   - Stop cache cleanup service
   - Close HTTP server
   - Log shutdown completion

**Commit**: `H-10: Add comprehensive error handling and graceful shutdown`

---

## 6. Phase 3 — Integration & Cross-Service Features

> **Requires both WS-P and WS-H Phase 1 and Phase 2 complete (core APIs functional).**

---

#### I-01: End-to-end token validation → JWT → HLS playback integration test

**Depends on**: P-08, H-06

**Objective**: Verify the complete flow from token entry to video segment delivery across both services.

**Files to create**:
```
tests/
├── integration/
│   ├── setup.ts                  # Test harness: start both services
│   ├── token-to-playback.test.ts # Full flow test
│   └── helpers.ts                # Test utilities (create event, generate token)
```

**Implementation Details**:

1. **Test harness** (`setup.ts`):
   - Start Platform App on random port
   - Start HLS Media Server on random port (with test stream files)
   - Seed database with test events
   - Provide cleanup after tests

2. **Test cases** (`token-to-playback.test.ts`):
   - ✅ Valid token → JWT issued (with `sid` claim) → HLS request succeeds
   - ✅ Invalid token → 401 error, no JWT issued
   - ✅ Expired token → 410 error
   - ✅ Revoked token → 403 error
   - ✅ Deactivated event → 403 error
   - ✅ Token already in use (active session) → 409 error with `inUse: true`
   - ✅ Token in use but session timed out → validation succeeds, new session created
   - ✅ Session heartbeat keeps session alive → subsequent validate returns 409
   - ✅ Session released → subsequent validate succeeds
   - ✅ JWT expired → HLS request returns 403
   - ✅ JWT with wrong path prefix → 403
   - ✅ JWT refresh with valid token and matching `sid` → new JWT issued with same `sid`
   - ✅ JWT refresh with revoked token → refresh fails
   - ✅ Heartbeat with valid session → 200 OK
   - ✅ Heartbeat with expired/released session → 404
   - ✅ Release session → 200, token becomes available
   - ✅ Safari fallback: `__token` query parameter accepted
   - ✅ Rate limiting: 6th validation in 60s → 429

3. **Test stream files**: Create a minimal valid HLS structure under `tests/fixtures/streams/`:
   ```
   tests/fixtures/streams/test-event-id/
   ├── stream.m3u8       # Master playlist
   └── segment-000.ts    # Tiny test segment (can be a few bytes)
   ```

**Commit**: `I-01: Add end-to-end integration tests for token validation and HLS playback`

---

#### I-02: Test revocation sync between Platform App and HLS server

**Depends on**: P-08, H-03

**Objective**: Verify the revocation cache sync mechanism works end-to-end.

**Files to create**:
```
tests/integration/
└── revocation-sync.test.ts
```

**Test cases**:
- ✅ Revoke token on Platform → wait for sync cycle → HLS server rejects the token
- ✅ Deactivate event on Platform → sync includes all event token codes → HLS blocks all
- ✅ Un-revoke token → next sync no longer includes it (but cache entry remains until eviction)
- ✅ Platform unreachable → HLS continues with stale cache, alert after 5 minutes
- ✅ `X-Internal-Api-Key` mismatch → sync returns 401

**Commit**: `I-02: Add integration tests for revocation sync between services`

---

#### I-03: Wire up Viewer Portal with live HLS server connection

**Depends on**: P-12, H-06

**Objective**: Connect the frontend player to the actual HLS server with JWT-authenticated requests.

**Files to modify**:
```
platform/src/components/player/video-player.tsx
platform/src/hooks/use-jwt-refresh.ts
platform/src/hooks/use-session-heartbeat.ts
platform/src/hooks/use-session-release.ts
```

**Implementation Details**:

1. Verify hls.js `xhrSetup` correctly injects current JWT from `use-jwt-refresh` hook
2. Test that JWT refresh seamlessly updates the token used by hls.js (no playback interruption)
3. Test Safari detection and `__token` query parameter fallback
4. Test segment-level 403 handling: player catches error → attempts one refresh → shows overlay if refresh fails
5. Test session heartbeat: verify heartbeat keeps session alive, 404/409 responses stop playback
6. Test session release on page close: verify `sendBeacon` fires on `beforeunload`
7. Handle network interruption: exponential backoff with max 5 retries (PDR §11)

**Commit**: `I-03: Wire Viewer Portal player to HLS server with JWT auth and error handling`

---

#### I-04: Implement event status polling with stream probing

**Depends on**: P-07, H-09

**Objective**: Connect the pre-event countdown screen to the event status API with probe JWT support.

**Files to modify**:
```
platform/src/lib/stream-probe.ts
platform/src/hooks/use-event-status.ts
```

**Implementation Details**:

1. Verify probe JWT (10s expiry, `probe: true` claim) is correctly minted and used
2. Verify HLS server only allows HEAD for probe JWTs
3. Test pre-event screen → auto-transition when stream goes live
4. Test fallback to time-based `isLive` when probe fails

**Commit**: `I-04: Implement stream probing for live status detection`

---

#### I-05: Add unit tests for Platform App API routes

**Depends on**: P-08

**Objective**: Unit tests for all Platform App API routes.

**Files to create**:
```
platform/src/__tests__/
├── api/
│   ├── tokens-validate.test.ts
│   ├── playback-refresh.test.ts
│   ├── playback-heartbeat.test.ts
│   ├── playback-release.test.ts
│   ├── revocations.test.ts
│   ├── event-status.test.ts
│   └── admin/
│       ├── auth.test.ts
│       ├── events.test.ts
│       └── tokens.test.ts
├── lib/
│   ├── jwt.test.ts
│   ├── token-generator.test.ts
│   ├── session-service.test.ts
│   └── rate-limiter.test.ts
```

**Implementation Details**:

1. Install: `npm install -D jest @types/jest ts-jest`
2. Configure Jest for Next.js API route testing
3. Mock Prisma client for database isolation
4. Test all validation rules, error responses, rate limiting, and edge cases per PDR
5. Test token generation uniqueness and batch operations
6. Test JWT minting and verification round-trip (including `sid` claim)
7. Test session service: create, heartbeat, release, timeout detection, stale session cleanup
8. Test single-device enforcement: validate returns 409 when active session exists
9. Test heartbeat returns 404 for expired sessions, 409 for conflicting sessions

**Commit**: `I-05: Add unit tests for Platform App API routes and utilities`

---

#### I-06: Add unit tests for HLS Media Server

**Depends on**: H-10

**Objective**: Unit tests for all HLS server components.

**Files to create**:
```
hls-server/src/__tests__/
├── middleware/
│   └── jwt-auth.test.ts
├── services/
│   ├── revocation-cache.test.ts
│   ├── revocation-sync.test.ts
│   ├── content-resolver.test.ts
│   ├── upstream-proxy.test.ts
│   └── cache-cleanup.test.ts
└── utils/
    ├── path-safety.test.ts
    └── hash.test.ts
```

**Implementation Details**:

1. Install: `npm install -D jest @types/jest ts-jest`
2. Test JWT validation: valid/expired/wrong-signature/wrong-path/probe tokens
3. Test revocation cache: add/check/evict operations
4. Test path safety: traversal attacks rejected
5. Test content resolver: local → cache → upstream fallback order
6. Test in-flight deduplication: concurrent requests result in single upstream fetch
7. Test manifest caching: live (no-cache) vs VOD (24h cache)

**Commit**: `I-06: Add unit tests for HLS Media Server components`

---

## 7. Phase 4 — Polish, Security & Production Readiness

> **Final phase. All features complete. Focus on security hardening, responsive design, accessibility, and deployment.**

---

#### F-01: Add responsive design and mobile adaptations

**Depends on**: P-12

**Objective**: Implement all responsive breakpoints and mobile-specific behaviors (PDR §13).

**Files to modify**:
```
platform/src/components/player/     # All player components
platform/src/components/viewer/     # Token entry components
platform/src/components/admin/      # Admin components
```

**Implementation Details**:

1. Responsive breakpoints (PDR §13.2): `<480px`, `480-767px`, `768-1023px`, `1024-1439px`, `≥1440px`
2. Mobile adaptations (PDR §13.3, §15.6):
   - Stacked layout on mobile: progress bar full-width above controls
   - Larger touch targets: `min-h-12` for all interactive elements
   - Volume slider: popover on mobile instead of inline
   - Always-visible controls on mobile with translucent background
   - Token entry: full-width input with large text
3. Orientation handling: prompt to rotate for landscape viewing, auto-fullscreen gesture
4. Touch gestures: tap play/pause, double-tap ±10s seek, swipe on progress bar
5. Keyboard shortcuts: Space, F, M, Arrow keys (PDR §13.4)

**Commit**: `F-01: Add responsive design, mobile adaptations, and keyboard shortcuts`

---

#### F-02: Add accessibility (ARIA labels, screen reader support)

**Depends on**: F-01

**Objective**: Ensure all controls are accessible per PDR §13.4.

**Files to modify**: All player and form components

**Implementation Details**:

1. ARIA labels on all interactive elements:
   - Play/pause button: `aria-label="Play"` / `aria-label="Pause"`
   - Volume slider: `aria-label="Volume"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`
   - Progress bar: `aria-label="Video progress"`, time values
   - Fullscreen: `aria-label="Enter fullscreen"` / `aria-label="Exit fullscreen"`
2. Live regions: `aria-live="polite"` for state change announcements (buffering, live/ended, errors)
3. Focus management: keyboard tab order through controls
4. Color contrast: verify WCAG AA compliance for all text/background pairs (PDR §14.1 confirms ratios)
5. Pinch-to-zoom disabled on player only (`touch-action: manipulation`)

**Commit**: `F-02: Add ARIA labels, live regions, and keyboard accessibility`

---

#### F-03: Add animations and polish (Framer Motion)

**Depends on**: P-12

**Objective**: Implement all animation specifications from PDR §14.3.

**Files to modify**: Player controls, token entry, admin components

**Implementation Details**:

1. Controls fade in/out: 200–300ms ease-out (Framer Motion `AnimatePresence`)
2. Progress bar: subtle spring physics on scrub
3. Fullscreen transitions: seamless entry/exit
4. Hover states: 100ms response time
5. Token validation: loading spinner → success checkmark → smooth transition to player
6. Live badge: CSS pulsing red dot (2s interval)
7. Countdown timer: smooth number transitions (no flicker)
8. Play/pause: icon morph with rotation
9. Toast notifications: slide-in from bottom-right

**Commit**: `F-03: Add Framer Motion animations for controls, transitions, and states`

---

#### F-04: Security hardening and rate limiting verification

**Depends on**: I-01

**Objective**: Verify all security requirements from PDR §12.

**Files to create/modify**:
```
platform/src/middleware.ts         # Rate limiting middleware
platform/src/lib/audit-logger.ts   # Audit logging
```

**Implementation Details**:

1. Rate limiting verification:
   - Token validation: 5/min per IP ✓
   - JWT refresh: 12/hour per token code ✓
   - Admin login: 10/min per IP ✓

2. Input sanitization:
   - Token codes: alphanumeric only (reject non-alphanumeric server-side)
   - Event fields: validate and sanitize all inputs
   - URL fields: format validation only

3. Audit logging (`audit-logger.ts`):
   - Log all: token validations (success/failure), JWT issuances, JWT refreshes, session creation/heartbeat/release/timeout, admin actions
   - Include: timestamp, IP, action type, event/token IDs, session ID (where applicable)
   - HLS server: hash token codes in logs (never raw)

4. Single-device enforcement verification:
   - Session state stored in database (survives restarts, works across scaled instances)
   - Session timeout (`SESSION_TIMEOUT_SECONDS`, default: 60) balances security vs usability
   - Heartbeat interval (30s) is roughly half the timeout for retry window
   - `409 Conflict` response reveals no details about the other device (PDR §12, point 13)

5. Security headers:
   - HSTS: `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production)
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`

5. CORS: Platform App same-origin only; HLS server specific origin from env

**Commit**: `F-04: Security hardening — rate limiting, audit logging, input sanitization, headers`

---

#### F-05: Add `.env.example` files and deployment documentation

**Depends on**: I-02

**Objective**: Finalize environment configuration and deployment docs.

**Files to create**:
```
platform/.env.example
hls-server/.env.example
DEPLOYMENT.md                    # Deployment guide
docker-compose.yml               # Local development setup
platform/Dockerfile
hls-server/Dockerfile
```

**Implementation Details**:

1. **Service-specific `.env.example`** files with all variables documented

2. **`docker-compose.yml`** — Co-located development setup (PDR §18.3 Option A):
   ```yaml
   services:
     platform:
       build: ./platform
       ports: ["3000:3000"]
       environment:
         DATABASE_URL: file:./dev.db
         # ... all required env vars
       depends_on: []

     hls-server:
       build: ./hls-server
       ports: ["4000:4000"]
       volumes:
         - ./test-streams:/streams
       environment:
         PLATFORM_APP_URL: http://platform:3000
         STREAM_ROOT: /streams
         # ... all required env vars
   ```

3. **`DEPLOYMENT.md`**:
   - Prerequisites
   - Local development setup (docker-compose and manual)
   - Production deployment with all three topology options (PDR §18.3)
   - Environment variable reference
   - Database migration guide (SQLite → PostgreSQL)
   - Generating the admin password hash
   - Generating the signing secret

**Commit**: `F-05: Add deployment docs, Docker configuration, and env examples`

---

#### F-06: Add admin password hash generation script

**Depends on**: P-04

**Objective**: Create a utility script which admin can use to generate the bcrypt password hash for `ADMIN_PASSWORD_HASH`.

**Files to create**:
```
scripts/
└── hash-password.ts          # CLI tool: npx ts-node scripts/hash-password.ts
```

**Implementation Details**:
```typescript
import bcrypt from 'bcrypt';
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Enter admin password: ', async (password) => {
  const hash = await bcrypt.hash(password, 12);
  console.log(`\nADMIN_PASSWORD_HASH=${hash}`);
  rl.close();
});
```

Add to root `package.json`: `"hash-password": "ts-node scripts/hash-password.ts"`

**Commit**: `F-06: Add admin password hash generation script`

---

#### F-07: Add database seed script for development

**Depends on**: P-06

**Objective**: Create a Prisma seed script with sample events and tokens for development.

**Files to create**:
```
platform/prisma/
└── seed.ts
```

**Implementation Details**:

1. Create 3 sample events:
   - One upcoming (starts in 2 hours)
   - One currently live (started 1 hour ago, ends in 2 hours)
   - One ended but within access window

2. Generate 10 tokens per event with various states:
   - Some unused, some redeemed, one revoked, one expired

3. Add to `platform/package.json`:
   ```json
   { "prisma": { "seed": "ts-node prisma/seed.ts" } }
   ```

4. Run with: `npx prisma db seed`

**Commit**: `F-07: Add Prisma database seed script with sample events and tokens`

---

#### F-08: Final CI/CD configuration and pre-commit hooks

**Depends on**: I-05, I-06

**Objective**: Set up CI pipeline and development hooks.

**Files to create**:
```
.github/
├── workflows/
│   ├── ci.yml                # Lint, typecheck, test on PR
│   └── deploy.yml            # Deployment workflow (placeholder)
.husky/
└── pre-commit                # Lint + typecheck on commit
```

**Implementation Details**:

1. **`.github/workflows/ci.yml`**:
   ```yaml
   name: CI
   on: [push, pull_request]
   jobs:
     lint-and-test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: '20' }
         - run: npm ci
         - run: npm run lint
         - run: npm run format:check
         - run: cd platform && npx prisma generate
         - run: cd platform && npm test
         - run: cd hls-server && npm test
         - run: cd platform && npm run typecheck
         - run: cd hls-server && npm run typecheck
   ```

2. **Pre-commit hooks**: Install husky + lint-staged
   ```bash
   npm install -D husky lint-staged
   npx husky init
   ```

**Commit**: `F-08: Add GitHub Actions CI workflow and pre-commit hooks`

---

## Appendix: Task Summary Table

| ID | Title | Depends On | Stream | Phase |
|----|-------|-----------|--------|-------|
| S-01 | Initialize monorepo and root configuration | — | Shared | 0 |
| S-02 | Create shared package with types and constants | S-01 | Shared | 0 |
| S-03 | Add shared validation helpers and developer README | S-02 | Shared | 0 |
| P-01 | Initialize Next.js project with TypeScript and Tailwind | S-03 | Platform | 1 |
| P-02 | Set up Prisma ORM with database schema (Event, Token, ActiveSession) | P-01 | Platform | 1 |
| P-03 | Implement JWT signing, token code generation, and session service | P-02 | Platform | 1 |
| P-04 | Implement admin authentication (login/logout/session) | P-01 | Platform | 1 |
| P-05 | Implement admin event CRUD API routes | P-02, P-04 | Platform | 1 |
| P-06 | Implement admin token management API routes | P-03, P-05 | Platform | 1 |
| P-07 | Implement public token validation API route (with session enforcement) | P-03, P-02 | Platform | 1 |
| P-08 | Implement JWT refresh, heartbeat, release, and revocation sync API routes | P-03, P-07 | Platform | 1 |
| P-09 | Install and configure shadcn/ui component library | P-01 | Platform | 2 |
| P-10 | Build Viewer Portal — Token Entry Screen | P-09 | Platform | 2 |
| P-11 | Build HTML5 video player component | P-09 | Platform | 2 |
| P-12 | Build Player Screen with JWT refresh, session heartbeat/release, and expiry | P-10, P-11 | Platform | 2 |
| P-13 | Build Admin Console — Login page | P-09, P-04 | Platform | 2 |
| P-14 | Build Admin Console — Event Management UI | P-13, P-05 | Platform | 2 |
| P-15 | Build Admin Console — Token Management UI | P-13, P-06 | Platform | 2 |
| P-16 | Build Admin Console — Dashboard | P-14, P-15 | Platform | 2 |
| H-01 | Initialize Express.js project with TypeScript | S-03 | HLS | 1 |
| H-02 | Implement JWT validation middleware | H-01 | HLS | 1 |
| H-03 | Implement revocation cache and sync service | H-01 | HLS | 1 |
| H-04 | Implement local file serving (Mode A) | H-02 | HLS | 1 |
| H-05 | Implement upstream proxy with persistent caching (Mode B) | H-04 | HLS | 1 |
| H-06 | Implement health endpoint and structured logging | H-03, H-04 | HLS | 1 |
| H-07 | Implement segment cache cleanup and LRU eviction | H-05 | HLS | 2 |
| H-08 | Implement manifest caching strategy and VOD detection | H-05 | HLS | 2 |
| H-09 | Add probe JWT support and HEAD request handling | H-02 | HLS | 2 |
| H-10 | Add comprehensive error handling and graceful shutdown | H-06 | HLS | 2 |
| I-01 | End-to-end integration test: token → JWT → HLS playback | P-08, H-06 | Integration | 3 |
| I-02 | Test revocation sync between services | P-08, H-03 | Integration | 3 |
| I-03 | Wire Viewer Portal with live HLS server connection | P-12, H-06 | Integration | 3 |
| I-04 | Implement event status polling with stream probing | P-07, H-09 | Integration | 3 |
| I-05 | Add unit tests for Platform App | P-08 | Integration | 3 |
| I-06 | Add unit tests for HLS Media Server | H-10 | Integration | 3 |
| F-01 | Add responsive design and mobile adaptations | P-12 | Polish | 4 |
| F-02 | Add accessibility (ARIA, screen reader) | F-01 | Polish | 4 |
| F-03 | Add animations and polish (Framer Motion) | P-12 | Polish | 4 |
| F-04 | Security hardening and rate limiting verification | I-01 | Polish | 4 |
| F-05 | Deployment docs, Docker, env examples | I-02 | Polish | 4 |
| F-06 | Admin password hash generation script | P-04 | Polish | 4 |
| F-07 | Database seed script for development | P-06 | Polish | 4 |
| F-08 | CI/CD configuration and pre-commit hooks | I-05, I-06 | Polish | 4 |

---

## Appendix: Parallel Execution Guide

**Three developers can work simultaneously after Phase 0:**

```
Week 1:   [Dev A] S-01 → S-02 → S-03 (all devs blocked until complete)

Week 2+:  [Dev B] P-01 → P-02 → P-03 ─┐
                   P-04 ─────────────── P-05 → P-06
                                         P-07 → P-08
                   P-09 → P-10 ──┐
                          P-11 ──┤
                                 P-12 ──────────────→ (integration)
                   P-13 → P-14 → P-16
                          P-15 ──┘

          [Dev C] H-01 → H-02 → H-04 → H-05 → H-07
                         H-03              │     H-08
                              H-06 ────────┘     H-09
                                                  H-10 → (integration)

Week N:   [All]  I-01 → I-02 → I-03 → I-04
                  I-05, I-06 (can parallel with I-01–I-04)
                  F-01 → F-02
                  F-03, F-04, F-05, F-06, F-07 (can parallel)
                  F-08 (last)
```

**Note**: Within each stream, some tasks can also be parallelized. For example, in the Platform stream, P-04 (admin auth) is independent of P-02 (Prisma setup) and can run concurrently. Similarly, P-09 (shadcn setup) only depends on P-01 and can start while P-02–P-08 are in progress.
