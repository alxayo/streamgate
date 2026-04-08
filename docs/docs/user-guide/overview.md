---
sidebar_position: 1
title: Overview
---

# StreamGate Overview

StreamGate is a **ticket-gated video streaming platform** that lets you distribute unique access codes to viewers, granting them secure, time-limited access to live streams and recordings. No accounts, no passwords — just a simple code entry and instant playback.

## Who Is It For?

- **Event organizers** running paid live streams (conferences, concerts, workshops)
- **Educators** distributing recorded lectures to enrolled students
- **Businesses** sharing internal town halls or training sessions with controlled access
- **Content creators** selling access to premium video content

## Two Services, One Platform

StreamGate runs as two cooperating services in a single monorepo:

| Service | Role | Tech | Port |
|---------|------|------|------|
| **Platform App** | Viewer portal, admin console, API, database | Next.js, Prisma, SQLite/PostgreSQL | 3000 |
| **HLS Media Server** | JWT-validated HLS stream delivery | Express.js | 4000 |

They share one HMAC secret (`PLAYBACK_SIGNING_SECRET`) for signing and verifying JWT playback tokens. The HLS server has **zero database dependencies** — it validates every request using pure cryptography.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Viewer's Browser                             │
│  ┌──────────────┐       ┌──────────────────────────────────────┐    │
│  │ Token Entry   │       │ HLS Player (hls.js)                  │    │
│  │ Page          │       │ Authorization: Bearer <JWT>           │    │
│  └──────┬───────┘       └──────────────┬───────────────────────┘    │
│         │                              │                            │
└─────────┼──────────────────────────────┼────────────────────────────┘
          │                              │
          │ POST /api/tokens/validate    │ GET /streams/:eventId/*.m3u8
          │                              │ GET /streams/:eventId/*.ts
          ▼                              ▼
┌─────────────────────┐       ┌──────────────────────────┐
│   Platform App       │       │   HLS Media Server        │
│   (Next.js :3000)    │       │   (Express :4000)          │
│                      │       │                            │
│ • Token validation   │       │ • JWT signature check      │
│ • JWT issuance       │       │   (HMAC-SHA256, ~0.01ms)   │
│ • Admin console      │       │ • Revocation cache         │
│ • Revocation sync    │◄──────│   (polls every 30s)        │
│ • Session tracking   │       │ • Serves .m3u8 + .ts       │
│                      │       │ • Local / proxy / hybrid    │
│   ┌──────────┐       │       └──────────────────────────┘
│   │ Database │       │
│   │ SQLite/PG│       │
│   └──────────┘       │
└──────────────────────┘
```

## Key Features

### 🎟️ Token-Gated Access
Distribute unique 12-character access codes to your audience. Each code is tied to a specific event and has a configurable expiration window.

### 🔐 JWT-Secured Streaming
Every HLS segment request is validated with a short-lived JWT — no database hit required. Sub-millisecond verification at any scale.

### ⚡ Real-Time Revocation
Revoke access codes instantly from the admin console. The HLS server's in-memory cache syncs every 30 seconds, blocking revoked tokens across all edge nodes.

### 📱 Single-Device Enforcement
Each token can only be used on one device at a time. Session heartbeats detect and prevent concurrent usage.

### 📺 Live + VOD Support
Stream live events via RTMP-to-HLS transcoding (FFmpeg), then automatically transition to VOD rewatch within the access window.

### 🛠️ Admin Console
Full-featured management interface for creating events, generating tokens in bulk, monitoring active sessions, and revoking access.

## Next Steps

- **[Quick Start (5 Minutes)](./quick-start.md)** — Go from zero to streaming in under 5 minutes
- **[Admin Console Guide](./admin-console.md)** — Learn how to manage events and tokens
- **[Configuration Reference](./configuration.md)** — All environment variables explained
