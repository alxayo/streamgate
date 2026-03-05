# Ticket-Gated Video Streaming Platform

A ticket-gated HTML5 video streaming platform with two independently deployable services sharing JWT-based playback authentication.

See [PDR.md](PDR.md) for full specification, data model, API contracts, and deployment topologies.
See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for development task breakdown.

## Architecture

| Service | Framework | Directory | Port |
|---------|-----------|-----------|------|
| **Platform App** | Next.js 14+ (TypeScript) | `platform/` | 3000 |
| **HLS Media Server** | Express.js (TypeScript) | `hls-server/` | 4000 |
| **Shared** | TypeScript types/constants | `shared/` | — |

## Prerequisites

- **Node.js** 20+ (see `.nvmrc`)
- **npm** 10+

## Quick Start

### 1. Environment Setup

```bash
cp .env.example .env
# Edit .env with your configuration:
# - Generate PLAYBACK_SIGNING_SECRET (min 32 random characters)
# - Generate INTERNAL_API_KEY (random string)
# - Generate ADMIN_PASSWORD_HASH: npm run hash-password
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Platform App

```bash
cd platform
npx prisma migrate dev    # Initialize/migrate database
npm run dev               # Next.js dev server on :3000
```

### 4. HLS Media Server

```bash
cd hls-server
npm run dev               # Express dev server on :4000
```

### 5. Generate Admin Password Hash

```bash
npm run hash-password
# Follow the prompt, then copy the output to ADMIN_PASSWORD_HASH in .env
```

## Project Structure

```
├── shared/               # Shared types, constants, and utilities
│   └── src/
│       ├── types.ts      # Domain types (JWT claims, API responses)
│       ├── constants.ts  # Shared constants (rate limits, timeouts)
│       ├── jwt.ts        # JWT utility functions
│       └── validation.ts # Input validation helpers
├── platform/             # Next.js Platform App
│   ├── prisma/           # Database schema and migrations
│   └── src/
│       ├── app/          # Next.js App Router (pages + API routes)
│       ├── components/   # React components (UI, player, admin, viewer)
│       ├── hooks/        # Custom React hooks
│       └── lib/          # Server-side utilities (JWT, auth, DB)
├── hls-server/           # Express.js HLS Media Server
│   └── src/
│       ├── middleware/    # JWT auth, CORS, logging
│       ├── routes/       # Stream serving, health, admin cache
│       ├── services/     # Revocation cache, upstream proxy, cache mgmt
│       └── utils/        # Path safety, hashing
```

## Environment Variables

See `.env.example` for a complete reference with documentation.

## Development Workflow

- Both services share the `@streaming/shared` workspace package
- Changes to `shared/` are immediately available in both services (no build step)
- Use `npx prisma studio` to inspect the database visually
- HLS test streams should be placed in `./streams/<eventId>/`
